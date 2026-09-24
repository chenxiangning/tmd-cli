//! 自建中继 · 手动兜底导出部署包(zip;证书/key 已烧入)。

use super::relay_core::bytes_to_b64;
use super::selfhost_assets::{self, SERVER_SOURCE};

/// 导出部署包:桌面即可直连所需的 mjs/env/证书/私钥/unit/README 一次打全,
/// 并同步落 settings 动态钉(webRelayCertDer 等)——用户照包部署完点连接即可。
#[tauri::command]
pub fn relay_selfhost_pack(
    app: tauri::AppHandle,
    path: String,
    host: String,
) -> Result<String, String> {
    let host = host.trim().to_string();
    let key = super::relay_core::new_relay_key();
    let cert = selfhost_assets::mint_cert(&host)?;
    let readme = format!(
        "tmd-cli 外网中继 · 自建服务器部署包(host: {host})\n\n\
         前置:服务器装 Node>=18;云安全组放行 80 与 443。\n\n\
         1) scp -r tmd-relay-selfhost/* root@{host}:/opt/tmd-relay/\n\
         2) mv /opt/tmd-relay/tmd-relay.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now tmd-relay\n\
         3) curl -sk https://{host}/healthz 应回 no agent(=服务活着,等桌面拨号)\n\n\
         回到 tmd-cli → 设置 → Web 访问 → 自建服务器:URL=https://{host},密钥=本包 env 里的 RELAY_KEY,点「连接中继」。"
    );
    let unit = selfhost_assets::render_unit().replace("{node}", "/usr/bin/node");
    let env = selfhost_assets::render_env(&key);
    let zip = super::relay_core::zip_store(&[
        (
            "tmd-relay-selfhost/tmd-relay-server.mjs",
            SERVER_SOURCE.as_bytes(),
        ),
        ("tmd-relay-selfhost/env", env.as_bytes()),
        (
            "tmd-relay-selfhost/relay-cert.pem",
            cert.cert_pem.as_bytes(),
        ),
        ("tmd-relay-selfhost/relay-key.pem", cert.key_pem.as_bytes()),
        ("tmd-relay-selfhost/tmd-relay.service", unit.as_bytes()),
        ("tmd-relay-selfhost/README.txt", readme.as_bytes()),
    ]);
    std::fs::write(&path, zip).map_err(|e| format!("写入 {path} 失败: {e}"))?;
    let mut settings = crate::settings::load_settings();
    settings["webRelayCertHost"] = serde_json::json!(host);
    settings["webRelayCertDer"] = serde_json::json!(bytes_to_b64(&cert.der));
    if let Err(error) = crate::settings::save_settings(&settings) {
        eprintln!("[selfhost] 设置落盘失败: {error}");
    }
    let _ = crate::event_sink::emit(&app, "settings:changed", &serde_json::json!({})); /* 双面:手机覆盖层也需感知证书钉 */
    Ok(path)
}
