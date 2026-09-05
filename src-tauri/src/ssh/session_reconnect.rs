//! SSH 自动重连 —— 意外断线的有界退避重连(超限后会话退出)。
//! 自 session.rs 拆出(文件规模铁则);连接/认证主流程留在 session.rs。

use std::sync::Arc;
use std::time::Duration;

use tauri::AppHandle;
use tokio::time::timeout;

use super::auth::{authenticate_ssh_handle, resolve_ssh_auth_material, SshAuthOutcome};
use super::io::emit_output;
use super::session::install_connected;
use super::transport::{connect_ssh_handle, CapturedHostKey};
use super::{
    SshRegistry, SshSessionEntry, SshSessionRuntime, SSH_RECONNECT_ATTEMPT_TIMEOUT,
    SSH_RECONNECT_DELAYS, SSH_RECONNECT_MAX_ATTEMPTS, STATUS_CONNECTED, STATUS_DISCONNECTED,
    STATUS_RECONNECTING,
};

/// 意外断线的有界重连(退避重试,超限后会话退出)。
pub(crate) async fn handle_unexpected_disconnect(
    app: AppHandle,
    registry: Arc<SshRegistry>,
    session_id: String,
    runtime: Arc<SshSessionRuntime>,
    connection_id: usize,
) {
    if !runtime.begin_reconnect_runner() {
        return;
    }
    if runtime.current_connection_id() != connection_id {
        runtime.finish_reconnect_runner();
        return;
    }
    runtime.clear_connection_if_current(connection_id).await;
    if runtime.is_closing() {
        runtime.finish_reconnect_runner();
        return;
    }
    let Ok(entry) = registry.entry(&session_id) else {
        runtime.finish_reconnect_runner();
        return;
    };
    for attempt in 1..=SSH_RECONNECT_MAX_ATTEMPTS {
        if runtime.is_closing() {
            runtime.finish_reconnect_runner();
            return;
        }
        registry.broadcast_status(&app, &session_id, STATUS_RECONNECTING, None);
        emit_output(
            &app,
            &registry,
            &session_id,
            format!("\r\n[SSH] 连接断开,正在重连({attempt}/{SSH_RECONNECT_MAX_ATTEMPTS})...\r\n")
                .as_bytes(),
        );
        let delay = SSH_RECONNECT_DELAYS
            .get(usize::from(attempt.saturating_sub(1)))
            .copied()
            .unwrap_or(Duration::from_secs(10));
        tokio::time::sleep(delay).await;
        if runtime.is_closing() {
            runtime.finish_reconnect_runner();
            return;
        }
        let result = match timeout(
            SSH_RECONNECT_ATTEMPT_TIMEOUT,
            reconnect_once(&app, &registry, &session_id, &entry),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => Err(format!(
                "SSH 重连超时({} 秒)",
                SSH_RECONNECT_ATTEMPT_TIMEOUT.as_secs()
            )),
        };
        match result {
            Ok(()) => {
                registry.broadcast_status(&app, &session_id, STATUS_CONNECTED, None);
                runtime.finish_reconnect_runner();
                return;
            }
            Err(error) => {
                emit_output(
                    &app,
                    &registry,
                    &session_id,
                    format!("[SSH] 重连失败: {error}\r\n").as_bytes(),
                );
            }
        }
    }
    registry.broadcast_status(
        &app,
        &session_id,
        STATUS_DISCONNECTED,
        Some(format!("自动重连 {SSH_RECONNECT_MAX_ATTEMPTS} 次未成功")),
    );
    registry.finish_session(&app, &session_id);
    runtime.finish_reconnect_runner();
}

/// 单次重连:静默建连(host key 必须 Known;KBI 主机自动重连不支持)。
async fn reconnect_once(
    app: &AppHandle,
    registry: &Arc<SshRegistry>,
    session_id: &str,
    entry: &Arc<SshSessionEntry>,
) -> Result<(), String> {
    let host = entry.host.normalized()?;
    let auth = resolve_ssh_auth_material(&host)?;
    let captured = Arc::new(tokio::sync::Mutex::new(None::<CapturedHostKey>));
    let mut handle = match connect_ssh_handle(&host, Arc::clone(&captured)).await {
        Ok(handle) => handle,
        Err(error) => {
            if captured.lock().await.is_some() {
                return Err("主机密钥待确认,自动重连不弹信任流".to_string());
            }
            return Err(error);
        }
    };
    match authenticate_ssh_handle(&mut handle, &host, auth).await? {
        SshAuthOutcome::Authenticated => {}
        SshAuthOutcome::KeyboardInteractivePrompt(_) => {
            let _ = handle
                .disconnect(
                    russh::Disconnect::ByApplication,
                    "重连需要键盘交互输入",
                    "zh",
                )
                .await;
            return Err("该主机需要键盘交互认证,自动重连不支持".to_string());
        }
    }
    install_connected(app, registry, session_id, entry, handle).await?;
    emit_output(
        app,
        registry,
        session_id,
        "\r\n[SSH] 已重连。\r\n".as_bytes(),
    );
    Ok(())
}
