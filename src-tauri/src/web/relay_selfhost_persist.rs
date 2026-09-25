//! 一键部署成功后的 settings 落盘:URL/key/动态证书钉 + 部署历史。
//! 历史 = 连接信息 + 密码/口令(点选整表回填;明文纪律对齐 settings.ssh.hosts,
//! 手机 dispatch 本就全量可读,不新增暴露面);私钥内容不落盘,只存路径。
//! upsert 键 = host:port:username,新者在前,上限 10(与前端 settingsRelayHistory.ts 一致)。

use super::relay_core::bytes_to_b64;
use super::selfhost_assets;

/// 部署请求里落盘的连接信息(密码/口令随历史存;私钥内容不落盘,只存路径)。
pub struct DeployConn<'a> {
    pub host: &'a str,
    pub port: u16,
    pub username: &'a str,
    pub auth_type: &'a str,
    pub private_key_path: &'a str,
    pub password: &'a str,
    pub passphrase: &'a str,
}

fn history_key(v: &serde_json::Value) -> String {
    format!(
        "{}:{}:{}",
        v["host"].as_str().unwrap_or_default(),
        v["port"].as_u64().unwrap_or(22),
        v["username"].as_str().unwrap_or_default()
    )
}

/// 历史 upsert:同键剔除、新者插前、截到上限 10。
pub fn upsert_history(
    old: Vec<serde_json::Value>,
    entry: serde_json::Value,
) -> Vec<serde_json::Value> {
    let new_key = history_key(&entry);
    let mut out = vec![entry];
    out.extend(old.into_iter().filter(|e| history_key(e) != new_key));
    out.truncate(10);
    out
}

pub fn persist_selfhost(
    app: &tauri::AppHandle,
    conn: &DeployConn,
    key: &str,
    cert: &selfhost_assets::RelayCert,
) {
    let host = conn.host;
    if let Err(error) = crate::settings::update_settings(|settings| {
        settings["webRelayUrl"] = serde_json::json!(format!("https://{host}"));
        settings["webRelayKey"] = serde_json::json!(key);
        settings["webRelayCertHost"] = serde_json::json!(host);
        settings["webRelayCertDer"] = serde_json::json!(bytes_to_b64(&cert.der));
        let entry = serde_json::json!({
            "host": host,
            "port": if conn.port == 0 { 22 } else { conn.port },
            "username": conn.username.trim(),
            "authType": conn.auth_type,
            "privateKeyPath": conn.private_key_path.trim(),
            "password": conn.password,
            "passphrase": conn.passphrase,
            "savedAt": crate::now_millis(),
        });
        let old = settings["relayDeployHistory"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        settings["relayDeployHistory"] = serde_json::Value::Array(upsert_history(old, entry));
    }) {
        eprintln!("[selfhost] 设置落盘失败: {error}");
    }
    let _ = crate::event_sink::emit(app, "settings:changed", &serde_json::json!({}));
    /* event_sink:webview+WS 双面(手机覆盖层同步) */
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(host: &str, port: u64, user: &str) -> serde_json::Value {
        serde_json::json!({ "host": host, "port": port, "username": user })
    }

    #[test]
    fn history_key_joins_three_parts() {
        assert_eq!(
            history_key(&entry("1.2.3.4", 22, "root")),
            "1.2.3.4:22:root"
        );
    }

    #[test]
    fn upsert_moves_same_key_entry_to_front_and_caps_at_10() {
        let old: Vec<serde_json::Value> = (0..10)
            .map(|i| entry(&format!("h{i}"), 22, "root"))
            .collect();
        let out = upsert_history(old, entry("h5", 22, "root"));
        assert_eq!(out.len(), 10);
        assert_eq!(history_key(&out[0]), "h5:22:root");
        assert!(!out.iter().skip(1).any(|e| history_key(e) == "h5:22:root"));
    }
}
