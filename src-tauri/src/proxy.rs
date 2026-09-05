//! 网络代理 —— 应用进程级代理环境变量注入(语义照抄 codemoss proxy_core)。
//!
//! 开启后向本进程注入 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY(大小写两套)= 代理地址,
//! NO_PROXY 与启动时继承的值合并(追加 localhost,127.0.0.1,::1);
//! 关闭时恢复启动快照而非清空 —— 用户 shell 原有代理要还原。
//!
//! 生效面:
//! - 客户端自身联网:quota_fetch 的 reqwest(每次请求新建 Client,即时吃到新 env)、
//!   installer 的 curl/npm 子进程;
//! - 之后 spawn 的全部 PTY CLI 子进程(portable-pty 默认继承进程 env,
//!   pty.rs 的 spec.env 仍可按 CLI 覆盖)。
//!
//! 已在跑的旧会话不受影响,需手动重启 —— 该语义由前端 network-proxy 插件提示。
//!
//! 设置 schema 归前端 kernel/settings.ts(settings.rs 设计决策:Rust 只透传 Value),
//! 本模块按 camelCase 键取 networkProxyEnabled / networkProxyUrl。

use std::sync::{LazyLock, Mutex};

const PROXY_ENV_KEYS: [&str; 8] = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
];
const DEFAULT_NO_PROXY: &str = "localhost,127.0.0.1,::1";
type ProxyEnvSnapshot = Vec<(&'static str, Option<String>)>;

static INITIAL_PROXY_ENV: LazyLock<Mutex<Option<ProxyEnvSnapshot>>> =
    LazyLock::new(|| Mutex::new(None));

#[cfg(test)]
static PROXY_ENV_TEST_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// 从 settings.json 透传对象解析代理配置(缺字段/类型不符 = 关闭 + 空地址;
/// disabledPlugins 含 network-proxy = 强制关闭,插件拔出即功能下电,开关为开也视同关)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProxyConfig {
    pub enabled: bool,
    pub url: String,
}

impl ProxyConfig {
    pub fn from_settings(value: &serde_json::Value) -> Self {
        let obj = value.as_object();
        // 拔出 network-proxy = 功能下电:Rust 侧不感知插件系统,这里读 settings.disabledPlugins
        // 兜住「拔出插件后重启不再注入 env」的设计语义(前端拔插写 disabledPlugins,重启生效)。
        let unplugged = obj
            .and_then(|o| o.get("disabledPlugins"))
            .and_then(|v| v.as_array())
            .is_some_and(|a| a.iter().any(|x| x.as_str() == Some("network-proxy")));
        let enabled = !unplugged
            && obj
                .and_then(|o| o.get("networkProxyEnabled"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
        let url = obj
            .and_then(|o| o.get("networkProxyUrl"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        Self { enabled, url }
    }
}

fn lock_proxy_env_state() -> std::sync::MutexGuard<'static, Option<ProxyEnvSnapshot>> {
    INITIAL_PROXY_ENV
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn snapshot_current_proxy_env() -> ProxyEnvSnapshot {
    PROXY_ENV_KEYS
        .iter()
        .map(|&key| (key, std::env::var(key).ok()))
        .collect()
}

fn initial_proxy_env_snapshot() -> ProxyEnvSnapshot {
    let mut snapshot = lock_proxy_env_state();
    if snapshot.is_none() {
        *snapshot = Some(snapshot_current_proxy_env());
    }
    snapshot.clone().unwrap_or_default()
}

fn restore_proxy_env_snapshot(snapshot: &[(&'static str, Option<String>)]) {
    clear_proxy_env();
    for (key, value) in snapshot {
        if let Some(value) = value {
            std::env::set_var(key, value);
        }
    }
}

fn append_no_proxy_values(values: &mut Vec<String>, raw: &str) {
    for item in raw.split(',') {
        let candidate = item.trim();
        if candidate.is_empty() {
            continue;
        }
        if values
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(candidate))
        {
            continue;
        }
        values.push(candidate.to_string());
    }
}

fn merged_no_proxy_value(snapshot: &[(&'static str, Option<String>)]) -> String {
    let mut values = Vec::new();
    for key in ["NO_PROXY", "no_proxy"] {
        if let Some(existing) = snapshot
            .iter()
            .find_map(|(snapshot_key, value)| (*snapshot_key == key).then_some(value.as_deref()))
            .flatten()
        {
            append_no_proxy_values(&mut values, existing);
        }
    }
    append_no_proxy_values(&mut values, DEFAULT_NO_PROXY);
    values.join(",")
}

/// 用 reqwest 试解析代理地址(http(s)/socks5),格式非法返回用户可读错误。
/// 前端 network-proxy 插件做同样的用户可见校验;这里兜手改 JSON 的场景。
pub fn validate(config: &ProxyConfig) -> Result<(), String> {
    if !config.enabled {
        return Ok(());
    }
    if config.url.is_empty() {
        return Err("网络代理已启用,但代理地址为空。".to_string());
    }
    reqwest::Proxy::all(&config.url)
        .map(|_| ())
        .map_err(|error| format!("代理地址无效: {error}"))
}

/// 应用代理到本进程 env。先恢复继承快照再叠加,保证反复开关幂等。
pub fn apply(config: &ProxyConfig) -> Result<(), String> {
    validate(config)?;
    let inherited_env = initial_proxy_env_snapshot();
    restore_proxy_env_snapshot(&inherited_env);
    if !config.enabled {
        return Ok(());
    }

    for key in [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
    ] {
        std::env::set_var(key, &config.url);
    }

    let no_proxy = merged_no_proxy_value(&inherited_env);
    for key in ["NO_PROXY", "no_proxy"] {
        std::env::set_var(key, &no_proxy);
    }

    Ok(())
}

/// 校验并应用;失败仅告警不报错 —— config_write_settings 是通用透传命令,
/// 不能因单个插件域的非法值拒绝整棵设置树的落盘。
pub fn apply_and_report(settings: &serde_json::Value) {
    if let Err(error) = apply(&ProxyConfig::from_settings(settings)) {
        eprintln!("[proxy] 应用网络代理失败: {error}");
    }
}

fn clear_proxy_env() {
    for key in PROXY_ENV_KEYS {
        std::env::remove_var(key);
    }
}

#[cfg(test)]
pub(crate) fn reset_initial_proxy_env_for_tests() {
    let mut snapshot = lock_proxy_env_state();
    *snapshot = Some(snapshot_current_proxy_env());
}

#[cfg(test)]
#[path = "proxy_tests.rs"]
mod tests;
