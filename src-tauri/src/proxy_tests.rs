//! proxy.rs 的单元测试(文件规模铁则拆出;经 #[path] 挂回 proxy::tests)。

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
fn from_settings_honors_disabled_plugins() {
    // 拔出 network-proxy = 强制关闭:开关为开也不注入
    let unplugged = serde_json::json!({
        "networkProxyEnabled": true,
        "networkProxyUrl": "http://127.0.0.1:7890",
        "disabledPlugins": ["git", "network-proxy"]
    });
    assert_eq!(
        ProxyConfig::from_settings(&unplugged),
        config(false, "http://127.0.0.1:7890")
    );
    // 其他插件被拔不影响代理
    let others = serde_json::json!({
        "networkProxyEnabled": true,
        "networkProxyUrl": "http://127.0.0.1:7890",
        "disabledPlugins": ["git"]
    });
    assert_eq!(
        ProxyConfig::from_settings(&others),
        config(true, "http://127.0.0.1:7890")
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
