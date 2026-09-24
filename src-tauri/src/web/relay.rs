//! 外网中继(状态与命令半):启动/停止/状态/部署,持久化与广播收口。

// file-size-exempt: relay 出站拨号+多路复用+部署,与 codemoss relay.rs 同源;拆分已做(state/core/agent 三件),再细即拆散同一条协议
use std::sync::atomic::{AtomicU64, Ordering};

use parking_lot::Mutex;
use tauri::Manager;
use tokio::sync::watch;

use super::relay_agent;
use super::relay_core;

#[derive(Default)]
pub struct RelayState {
    pub(super) inner: Mutex<Option<Running>>,
}

pub(super) struct Running {
    pub info: RelayInfo,
    pub stop: watch::Sender<bool>,
    /// 标记拥有本条的 agent 任务:换任务时旧任务不得写/拆新任务的状态。
    pub generation: u64,
}

/// 每个会话一个 id;见 Running::generation。
static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RelayInfo {
    /// 手机打开的地址(不含 token)。
    pub url: String,
    /// 桌面拨号的 Worker 基址。
    pub agent_url: String,
    pub connected: bool,
    /// 最近一次失败(设置卡展示)。
    pub error: Option<String>,
}

/// 应用重启动时要不要自动重连:开关开着才重连(无人值守可达性的关键)。
pub fn autostart_target(settings: &serde_json::Value) -> Option<(String, String)> {
    if settings.get("webRelayOn").and_then(|v| v.as_bool()) != Some(true) {
        return None;
    }
    let url = settings.get("webRelayUrl")?.as_str()?.trim();
    let key = settings.get("webRelayKey")?.as_str()?.trim();
    if url.is_empty() || key.is_empty() {
        return None;
    }
    Some((url.to_string(), key.to_string()))
}

/// 持久化 relay 开关;与 start/stop 同一把写锁内线性化。
fn persist_relay_state(
    app: &tauri::AppHandle,
    enabled: bool,
    target: Option<(&str, &str)>,
) -> Result<(), String> {
    crate::settings::update_settings(|settings| {
        if let Some((url, key)) = target {
            settings["webRelayUrl"] = serde_json::json!(url);
            settings["webRelayKey"] = serde_json::json!(key);
        }
        settings["webRelayOn"] = serde_json::json!(enabled);
    })?;
    /* 前端 settings store 监听此事件回读磁盘,避免 store 与盘分叉。 */
    let _ = crate::event_sink::emit(app, "settings:changed", &serde_json::json!({}));
    Ok(())
}

fn persist_bridge_enabled(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    if crate::settings::update_settings(|settings| {
        settings["webAccessEnabled"] == serde_json::json!(enabled)
    })? {
        return Ok(());
    }
    crate::settings::update_settings(|settings| {
        settings["webAccessEnabled"] = serde_json::json!(enabled);
    })?;
    let _ = crate::event_sink::emit(app, "settings:changed", &serde_json::json!({}));
    Ok(())
}

fn stop_relay_after_persist(
    persist: impl FnOnce() -> Result<(), String>,
    take_running: impl FnOnce() -> Option<Running>,
) -> Result<(), String> {
    persist()?;
    if let Some(running) = take_running() {
        let _ = running.stop.send(true);
    }
    Ok(())
}

#[tauri::command]
pub async fn web_relay_start(
    app: tauri::AppHandle,
    url: String,
    key: String,
) -> Result<RelayInfo, String> {
    let url = url.trim().to_string();
    let key = key.trim().to_string();
    let agent = relay_core::agent_url(&url, &key)?;
    let state = app.state::<crate::AppState>();
    // 起桥(确保 127.0.0.1:<port> 存在),relay 只经它服务。
    // 起桥后必须把 webAccessEnabled 回填为 true —— 否则任何 config_write_settings
    // 都会走 apply_settings(false) 把桥停掉,中继绿灯照亮但转发全失败。
    let bridge = super::web_access::web_access_start(app.clone()).await?;
    let Some(bridge_info) = bridge else {
        return Err("Web 桥启动失败".into());
    };
    persist_relay_state(&app, true, Some((&url, &key)))?;
    persist_bridge_enabled(&app, true)?;
    let bridge_port = bridge_info.port;

    let info = RelayInfo {
        // 手机 URL 必须带桥 token —— transport.ts 只从 URL ?token= 取凭据,
        // 缺它 /ws 握手必 403,外网链路不可用。
        url: format!(
            "{}?token={}",
            relay_core::phone_url(&url),
            bridge_info.token
        ),
        agent_url: agent.clone(),
        connected: false,
        error: None,
    };
    let (stop_tx, stop_rx) = watch::channel(false);
    let generation = NEXT_GENERATION.fetch_add(1, Ordering::Relaxed);
    {
        let mut guard = state.relay.inner.lock();
        if let Some(previous) = guard.take() {
            let _ = previous.stop.send(true);
        }
        *guard = Some(Running {
            info: info.clone(),
            stop: stop_tx,
            generation,
        });
    }

    let handle = app.clone();
    tokio::spawn(async move {
        relay_agent::run_agent(handle, agent, bridge_port, stop_rx, generation).await;
    });
    Ok(info)
}

#[tauri::command]
pub fn web_relay_stop(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<crate::AppState>();
    stop_relay_after_persist(
        // 停 relay 不回填 webAccessEnabled —— 桥是 LAN 自己的功能,用户可能正开着 LAN 用;
        // 若回填 false,此后任何 config_write_settings 都会走 apply_settings 把桥杀掉。
        || persist_relay_state(&app, false, None),
        || state.relay.inner.lock().take(),
    )?;
    broadcast_relay(&app);
    Ok(())
}

#[tauri::command]
pub fn web_relay_status(app: tauri::AppHandle) -> Option<RelayInfo> {
    let state = app.state::<crate::AppState>();
    let guard = state.relay.inner.lock();
    guard.as_ref().map(|r| r.info.clone())
}

/// 导出部署包(zip):Worker 源码 + wrangler 工程,key 烧入。
#[tauri::command]
pub fn relay_deploy_pack(path: String, key: Option<String>) -> Result<String, String> {
    relay_core::write_deploy_pack(&path, key.as_deref())
}

/// 一键部署到用户自有 Cloudflare 账号。
#[tauri::command]
pub async fn relay_deploy(
    token: String,
    account_id: Option<String>,
) -> Result<relay_core::RelayDeployResult, String> {
    relay_deploy_cf(token, account_id).await
}

async fn relay_deploy_cf(
    token: String,
    account_id: Option<String>,
) -> Result<relay_core::RelayDeployResult, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("缺少 Cloudflare API Token".to_string());
    }
    let account_id = account_id
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let key = relay_core::new_relay_key();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let (account_id, account_name) = cf_account(&client, &token, account_id.as_deref()).await?;
    let subdomain = cf_subdomain(&client, &token, &account_id).await?;

    let exists = client
        .get(format!(
            "{}/accounts/{}/workers/scripts/{}",
            relay_core::CF_API_BASE,
            account_id,
            relay_core::CF_SCRIPT_NAME
        ))
        .bearer_auth(&token)
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);

    let mut metadata = serde_json::json!({
        "main_module": "index.js",
        "compatibility_date": "2025-01-01",
        "bindings": [
            { "type": "durable_object_namespace", "name": "RELAY", "class_name": "Relay" },
            { "type": "secret_text", "name": "RELAY_KEY", "text": key.clone() },
        ],
    });
    if !exists {
        metadata["migrations"] = serde_json::json!({
            "new_tag": "v1",
            "steps": [{ "new_sqlite_classes": ["Relay"] }],
        });
    }
    let form = reqwest::multipart::Form::new()
        .part(
            "metadata",
            reqwest::multipart::Part::text(metadata.to_string())
                .mime_str("application/json")
                .map_err(|e| e.to_string())?,
        )
        .part(
            "index.js",
            reqwest::multipart::Part::text(relay_core::WORKER_SOURCE)
                .file_name("index.js")
                .mime_str("application/javascript+module")
                .map_err(|e| e.to_string())?,
        );
    let response = client
        .put(format!(
            "{}/accounts/{}/workers/scripts/{}",
            relay_core::CF_API_BASE,
            account_id,
            relay_core::CF_SCRIPT_NAME
        ))
        .bearer_auth(&token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("上传 Worker 失败: {e}"))?;
    cf_json(response, "上传 Worker").await?;

    let _ = client
        .post(format!(
            "{}/accounts/{}/workers/scripts/{}/subdomain",
            relay_core::CF_API_BASE,
            account_id,
            relay_core::CF_SCRIPT_NAME
        ))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "enabled": true }))
        .send()
        .await;

    Ok(relay_core::RelayDeployResult {
        url: format!(
            "https://{}.{}.workers.dev",
            relay_core::CF_SCRIPT_NAME,
            subdomain
        ),
        key,
        account_id,
        account_name,
    })
}

async fn cf_json(response: reqwest::Response, what: &str) -> Result<serde_json::Value, String> {
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let value: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    let success = value
        .get("success")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(status.is_success());
    if success && status.is_success() {
        return Ok(value);
    }
    let detail = value
        .get("errors")
        .and_then(|errors| errors.as_array())
        .map(|errors| {
            errors
                .iter()
                .filter_map(|error| error.get("message").and_then(|m| m.as_str()))
                .collect::<Vec<_>>()
                .join("; ")
        })
        .filter(|joined| !joined.is_empty())
        .unwrap_or_else(|| text.chars().take(200).collect());
    Err(format!("{what}失败(HTTP {status}): {detail}"))
}

const ACCOUNT_TOKEN_NEEDS_ID: &str = "这个 Token 是账户令牌(cfat_ 开头),Cloudflare 不允许它列出账户:请填 Account ID(Cloudflare 控制台右侧栏),或改用用户令牌(My Profile → API Tokens)";

async fn cf_account(
    client: &reqwest::Client,
    token: &str,
    account_id: Option<&str>,
) -> Result<(String, String), String> {
    if let Some(id) = account_id.map(str::trim).filter(|id| !id.is_empty()) {
        return Ok((id.to_string(), cf_account_name(client, token, id).await));
    }
    if token.starts_with("cfat_") {
        return Err(ACCOUNT_TOKEN_NEEDS_ID.to_string());
    }
    let response = client
        .get(format!("{}/accounts", relay_core::CF_API_BASE))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("读取账号失败: {e}"))?;
    let value = cf_json(response, "读取账号").await?;
    let account = value
        .get("result")
        .and_then(|result| result.as_array())
        .and_then(|list| list.first())
        .ok_or_else(|| "这个 Token 下没有可用的 Cloudflare 账号".to_string())?;
    let id = account
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if id.is_empty() {
        return Err("账号缺少 id".to_string());
    }
    let name = account
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    Ok((id, name))
}

async fn cf_account_name(client: &reqwest::Client, token: &str, id: &str) -> String {
    let Ok(response) = client
        .get(format!("{}/accounts/{}", relay_core::CF_API_BASE, id))
        .bearer_auth(token)
        .send()
        .await
    else {
        return id.to_string();
    };
    let Ok(value) = cf_json(response, "读取账号").await else {
        return id.to_string();
    };
    value
        .get("result")
        .and_then(|result| result.get("name"))
        .and_then(|v| v.as_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(id)
        .to_string()
}

async fn cf_subdomain(
    client: &reqwest::Client,
    token: &str,
    account_id: &str,
) -> Result<String, String> {
    let response = client
        .get(format!(
            "{}/accounts/{}/workers/subdomain",
            relay_core::CF_API_BASE,
            account_id
        ))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("读取 workers.dev 子域失败: {e}"))?;
    let value = cf_json(response, "读取 workers.dev 子域").await?;
    let subdomain = value
        .get("result")
        .and_then(|result| result.get("subdomain"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if subdomain.is_empty() {
        return Err(
            "这个账号还没设置 workers.dev 子域:先到 Cloudflare 控制台 Workers & Pages 页面设置一次"
                .to_string(),
        );
    }
    Ok(subdomain)
}

pub(super) fn set_connected(app: &tauri::AppHandle, generation: u64, connected: bool) {
    let state = app.state::<crate::AppState>();
    {
        let mut guard = state.relay.inner.lock();
        if let Some(running) = guard.as_mut().filter(|r| r.generation == generation) {
            running.info.connected = connected;
        }
    }
    broadcast_relay(app);
}

pub(super) fn set_error(app: &tauri::AppHandle, generation: u64, message: String) {
    let state = app.state::<crate::AppState>();
    {
        let mut guard = state.relay.inner.lock();
        if let Some(running) = guard.as_mut().filter(|r| r.generation == generation) {
            running.info.error = (!message.is_empty()).then_some(message);
        }
    }
    broadcast_relay(app);
}

fn broadcast_relay(app: &tauri::AppHandle) {
    crate::event_sink::emit(app, "web://relay", &serde_json::Value::Null);
}
