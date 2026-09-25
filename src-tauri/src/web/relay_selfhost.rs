//! 自建服务器中继 · 一键 SSH 部署命令面:连接 → 铸证书 → 上传 → systemd →
//! 健康自检;成功即把 URL/key/动态证书钉写进 settings。手动兜底 = 导出部署包
//! (zip,证书/key 已烧入)。凭据只在本次调用内存在,不落任何盘。

use serde::{Deserialize, Serialize};
use tauri::Emitter;

use super::relay_selfhost_persist;
use super::selfhost_assets::{self, SERVER_SOURCE};
use super::selfhost_ssh;
use crate::ssh::transport::SshHostWire;

const DIR: &str = "/opt/tmd-relay";
const UNIT_PATH: &str = "/etc/systemd/system/tmd-relay.service";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfhostDeployReq {
    pub host: String,
    #[serde(default)]
    pub port: u16,
    pub username: String,
    /// "password" | "privateKey"(与 SshHostWire.authType 同词表)。
    pub auth_type: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub private_key: String,
    #[serde(default)]
    pub private_key_path: String,
    #[serde(default)]
    pub private_key_passphrase: String,
    /// 未知主机指纹时,用户在 UI 点「信任并重试」置 true。
    #[serde(default)]
    pub trust_host_key: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployStep {
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfhostDeployResult {
    pub ok: bool,
    pub url: String,
    pub key: String,
    pub fingerprint: String,
    pub steps: Vec<DeployStep>,
    /// 仅当主机指纹未确认:前端弹「信任并重试」。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_key_fingerprint: Option<String>,
}

fn wire(req: &SelfhostDeployReq) -> SshHostWire {
    SshHostWire {
        name: req.host.clone(),
        host: req.host.trim().to_string(),
        port: if req.port == 0 { 22 } else { req.port },
        username: req.username.trim().to_string(),
        auth_type: req.auth_type.clone(),
        password: req.password.clone(),
        private_key: req.private_key.clone(),
        private_key_path: req.private_key_path.clone(),
        private_key_passphrase: req.private_key_passphrase.clone(),
        proxy: None,
    }
}

fn emit_step(app: &tauri::AppHandle, id: &str, ok: bool, error: Option<String>) {
    let _ = app.emit(
        "web-relay-deploy",
        serde_json::json!({ "step": id, "ok": ok, "error": error }),
    );
}

fn tail(text: &str) -> String {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(8)..].join("\n")
}

#[allow(clippy::too_many_arguments)]
fn fail(
    app: &tauri::AppHandle,
    steps: &mut Vec<DeployStep>,
    id: &str,
    error: String,
    host_key_fingerprint: Option<String>,
) -> SelfhostDeployResult {
    steps.push(DeployStep {
        id: id.into(),
        ok: false,
        error: Some(error.clone()),
    });
    emit_step(app, id, false, Some(error));
    SelfhostDeployResult {
        ok: false,
        url: String::new(),
        key: String::new(),
        fingerprint: String::new(),
        steps: steps.clone(),
        host_key_fingerprint,
    }
}

fn pass(steps: &mut Vec<DeployStep>, app: &tauri::AppHandle, id: &str) {
    steps.push(DeployStep {
        id: id.into(),
        ok: true,
        error: None,
    });
    emit_step(app, id, true, None);
}

#[tauri::command]
pub async fn relay_deploy_selfhost(
    app: tauri::AppHandle,
    req: SelfhostDeployReq,
) -> Result<SelfhostDeployResult, String> {
    let host = req.host.trim().to_string();
    if host.is_empty() || req.username.trim().is_empty() {
        return Err("服务器地址与用户名必填".into());
    }
    let key = super::relay_core::new_relay_key();
    let mut steps: Vec<DeployStep> = Vec::new();

    // connect
    let wire = wire(&req);
    let handle = match selfhost_ssh::connect_authed(&wire, req.trust_host_key).await {
        Ok(handle) => handle,
        Err(error) => {
            let hkp = error
                .strip_prefix("SSH 主机指纹未确认(")
                .and_then(|rest| rest.split(')').next())
                .map(str::to_string);
            let msg = hkp.clone().unwrap_or_else(|| error.clone());
            return Ok(fail(
                &app,
                &mut steps,
                "connect",
                error,
                (!msg.is_empty()).then_some(msg),
            ));
        }
    };
    pass(&mut steps, &app, "connect");

    // cert(桌面现场铸,私钥不出桌面 → 经 stdin 直写服务器)
    let cert = match selfhost_assets::mint_cert(&host) {
        Ok(cert) => cert,
        Err(error) => return Ok(fail(&app, &mut steps, "cert", error, None)),
    };
    pass(&mut steps, &app, "cert");

    // upload:mkdir + 四个文件走 exec+stdin 原样落盘
    let mkdir = selfhost_ssh::exec(&handle, &format!("mkdir -p {DIR}")).await;
    if let Err(error) = mkdir {
        return Ok(fail(&app, &mut steps, "upload", error, None));
    }
    let env = selfhost_assets::render_env(&key);
    let files: [(&str, &[u8]); 4] = [
        ("tmd-relay-server.mjs", SERVER_SOURCE.as_bytes()),
        ("env", env.as_bytes()),
        ("relay-cert.pem", cert.cert_pem.as_bytes()),
        ("relay-key.pem", cert.key_pem.as_bytes()),
    ];
    for (name, content) in files {
        match selfhost_ssh::exec_with_input(&handle, &format!("cat > {DIR}/{name}"), content).await
        {
            Ok(out) if out.exit == 0 => {}
            Ok(out) => {
                return Ok(fail(
                    &app,
                    &mut steps,
                    "upload",
                    format!("写 {name} 失败(exit {}): {}", out.exit, tail(&out.stderr)),
                    None,
                ))
            }
            Err(error) => return Ok(fail(&app, &mut steps, "upload", error, None)),
        }
    }
    match selfhost_ssh::exec(&handle, &format!("chmod 600 {DIR}/relay-key.pem {DIR}/env")).await {
        // 私钥+RELAY_KEY 落 0644 = 服务器全局可读;chmod 失败必须挡,不能让部署假成功。
        Ok(out) if out.exit == 0 => {}
        Ok(out) => {
            return Ok(fail(
                &app,
                &mut steps,
                "upload",
                format!("chmod 600 失败(exit {}): 私钥权限未收紧", out.exit),
                None,
            ))
        }
        Err(error) => return Ok(fail(&app, &mut steps, "upload", error, None)),
    }
    pass(&mut steps, &app, "upload");

    // systemd:探测 node 绝对路径 → 写 unit → enable --now
    let node_out = match selfhost_ssh::exec(&handle, "command -v node || echo MISSING").await {
        Ok(out) => out,
        Err(error) => return Ok(fail(&app, &mut steps, "systemd", error, None)),
    };
    let node = node_out.stdout.trim();
    if node.is_empty() || node == "MISSING" {
        return Ok(fail(
            &app,
            &mut steps,
            "systemd",
            "服务器未装 Node(>=18):先装 node 再重试".into(),
            None,
        ));
    }
    let unit = selfhost_assets::render_unit().replace("{node}", node);
    if let Err(error) =
        selfhost_ssh::exec_with_input(&handle, &format!("cat > {UNIT_PATH}"), unit.as_bytes()).await
    {
        return Ok(fail(&app, &mut steps, "systemd", error, None));
    }
    let start = match selfhost_ssh::exec(
        &handle,
        "systemctl daemon-reload && systemctl enable --now tmd-relay && systemctl restart tmd-relay",
    )
    .await
    {
        Ok(out) => out,
        Err(error) => return Ok(fail(&app, &mut steps, "systemd", error, None)),
    };
    if start.exit != 0 {
        return Ok(fail(
            &app,
            &mut steps,
            "systemd",
            format!("服务启动失败: {}", tail(&start.stderr)),
            None,
        ));
    }
    pass(&mut steps, &app, "systemd");

    // health:服务器本机 curl 自己(桌面侧另有证书钉,这里 -k)
    let health = match selfhost_ssh::exec(
        &handle,
        "sleep 1; curl -sk --max-time 5 https://127.0.0.1/healthz; echo",
    )
    .await
    {
        Ok(out) => out,
        Err(error) => return Ok(fail(&app, &mut steps, "health", error, None)),
    };
    if health.exit != 0 || !health.stdout.contains("agent") {
        return Ok(fail(
            &app,
            &mut steps,
            "health",
            format!("健康自检失败: {}", tail(&health.stdout)),
            None,
        ));
    }
    pass(&mut steps, &app, "health");

    // 成功:settings 一次写(url/key/动态钉/部署历史),连接卡经回填通道即时可见。
    relay_selfhost_persist::persist_selfhost(
        &app,
        &relay_selfhost_persist::DeployConn {
            host: &host,
            port: req.port,
            username: &req.username,
            auth_type: &req.auth_type,
            private_key_path: &req.private_key_path,
            password: &req.password,
            passphrase: &req.private_key_passphrase,
        },
        &key,
        &cert,
    );
    Ok(SelfhostDeployResult {
        ok: true,
        url: format!("https://{host}"),
        key,
        fingerprint: cert.fingerprint,
        steps,
        host_key_fingerprint: None,
    })
}
