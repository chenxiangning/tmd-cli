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

/// 从 settings.json 透传对象解析代理配置(缺字段/类型不符 = 关闭 + 空地址)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProxyConfig {
    pub enabled: bool,
    pub url: String,
}

impl ProxyConfig {
    pub fn from_settings(value: &serde_json::Value) -> Self {
        let obj = value.as_object();
        let enabled = obj
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
mod tests {
    use super::{
        apply, reset_initial_proxy_env_for_tests, validate, ProxyConfig, PROXY_ENV_KEYS,
        PROXY_ENV_TEST_LOCK,
    };

    fn snapshot_env() -> Vec<(&'static str, Option<String>)> {
        PROXY_ENV_KEYS
            .iter()
            .map(|&key| (key, std::env::var(key).ok()))
            .collect()
    }

    fn restore_env(snapshot: &[(&'static str, Option<String>)]) {
        for (key, value) in snapshot {
            if let Some(value) = value {
                std::env::set_var(key, value);
            } else {
                std::env::remove_var(key);
            }
        }
        reset_initial_proxy_env_for_tests();
    }

    fn config(enabled: bool, url: &str) -> ProxyConfig {
        ProxyConfig {
            enabled,
            url: url.to_string(),
        }
    }

    #[test]
    fn from_settings_reads_camel_case_fields() {
        let value = serde_json::json!({
            "networkProxyEnabled": true,
            "networkProxyUrl": "  http://127.0.0.1:7890  "
        });
        assert_eq!(
            ProxyConfig::from_settings(&value),
            config(true, "http://127.0.0.1:7890")
        );
        // 缺字段 = 关闭;非字符串 url = 空
        assert_eq!(
            ProxyConfig::from_settings(&serde_json::json!({})),
            config(false, "")
        );
        assert_eq!(
            ProxyConfig::from_settings(&serde_json::json!({"networkProxyEnabled": "yes"})),
            config(false, "")
        );
    }

    #[test]
    fn disabled_config_is_valid_without_url() {
        assert!(validate(&config(false, "")).is_ok());
    }

    #[test]
    fn enabled_config_requires_valid_url() {
        assert!(validate(&config(true, "")).is_err());
        assert!(validate(&config(true, "not a url")).is_err());
        assert!(validate(&config(true, "http://127.0.0.1:7890")).is_ok());
        assert!(validate(&config(true, "socks5://127.0.0.1:1080")).is_ok());
    }

    #[test]
    fn apply_populates_env_and_merges_no_proxy() {
        let _guard = PROXY_ENV_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let original_env = snapshot_env();
        super::clear_proxy_env();
        reset_initial_proxy_env_for_tests();

        apply(&config(true, "http://127.0.0.1:7890")).expect("apply proxy");
        assert_eq!(
            std::env::var("HTTP_PROXY").ok().as_deref(),
            Some("http://127.0.0.1:7890")
        );
        assert_eq!(
            std::env::var("all_proxy").ok().as_deref(),
            Some("http://127.0.0.1:7890")
        );
        assert_eq!(
            std::env::var("NO_PROXY").ok().as_deref(),
            Some("localhost,127.0.0.1,::1")
        );

        restore_env(&original_env);
    }

    #[test]
    fn disabling_restores_inherited_env() {
        let _guard = PROXY_ENV_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let original_env = snapshot_env();
        super::clear_proxy_env();
        std::env::set_var("HTTP_PROXY", "http://corp-gateway:8080");
        std::env::set_var("NO_PROXY", "corp.local,internal.example");
        reset_initial_proxy_env_for_tests();

        apply(&config(true, "http://127.0.0.1:7890")).expect("enable proxy");
        apply(&config(false, "")).expect("disable proxy");
        // 关闭 = 还原启动继承值,而非清空
        assert_eq!(
            std::env::var("HTTP_PROXY").ok().as_deref(),
            Some("http://corp-gateway:8080")
        );
        assert_eq!(
            std::env::var("NO_PROXY").ok().as_deref(),
            Some("corp.local,internal.example")
        );

        restore_env(&original_env);
    }
}
