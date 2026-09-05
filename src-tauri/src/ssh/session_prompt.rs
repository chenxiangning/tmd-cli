//! SSH 提示邮箱 —— host key 信任流与 KBI/密码应答的统一种投递。
//! 自 session.rs 拆出(文件规模铁则):PendingPrompt 登记 → ssh://prompt 事件 →
//! oneshot 等待(120s 超时 = 拒绝)。

use std::sync::Arc;

use tauri::{AppHandle, Emitter};
use tokio::time::timeout;

use super::known_hosts;
use super::transport::CapturedHostKey;
use super::{
    PendingPrompt, PromptAnswer, SshPromptEvent, SshRegistry, SSH_PROMPT_TIMEOUT, STATUS_CONNECTING,
};

/// host key 信任流:发提示 → 等 oneshot;信任则落库,拒绝/超时返回 false/Err。
pub(crate) async fn ask_host_key(
    app: &AppHandle,
    registry: &SshRegistry,
    session_id: &str,
    captured: CapturedHostKey,
) -> Result<bool, String> {
    let (key, status) = (captured.key, captured.status);
    let stored_fingerprint = match &status {
        known_hosts::KnownHostStatus::Changed { stored_fingerprint } => {
            Some(stored_fingerprint.clone())
        }
        _ => None,
    };
    let event = SshPromptEvent {
        prompt_id: String::new(),
        kind: "hostKey".to_string(),
        key_type: Some(key.key_type.clone()),
        fingerprint: Some(key.fingerprint_sha256.clone()),
        stored_fingerprint,
        name: None,
        instructions: None,
        prompt: None,
        echo: false,
    };
    let answer = ask_user(app, registry, session_id, event).await?;
    if !answer.trust_host_key {
        return Ok(false);
    }
    known_hosts::trust(&key)?;
    Ok(true)
}

/// 统一提示投递:登记 PendingPrompt → 发事件 → 等待 oneshot(120s 超时)。
/// Err = 超时/取消(连接任务终止会话);Ok 携带用户应答。
pub(crate) async fn ask_user(
    app: &AppHandle,
    registry: &SshRegistry,
    session_id: &str,
    mut event: SshPromptEvent,
) -> Result<PromptAnswer, String> {
    let prompt_id = crate::pty::uuid_v4();
    event.prompt_id = prompt_id.clone();
    let (responder_tx, responder_rx) = tokio::sync::oneshot::channel::<PromptAnswer>();
    registry.prompts.lock().insert(
        prompt_id.clone(),
        Arc::new(PendingPrompt {
            responder: responder_tx,
        }),
    );
    let _ = app.emit(&format!("ssh://prompt/{session_id}"), &event);
    /* 等待可见化:提示卡在右下角,状态卡同步说明在等什么,
    否则 120s 等待期表现为「一直连接中」,无从理解(实测踩坑)。 */
    let waiting = match event.kind.as_str() {
        "hostKey" => "等待主机密钥确认(右下角提示卡)",
        "kbi" => "等待键盘交互应答(右下角提示卡)",
        _ => "等待密码输入(右下角提示卡)",
    };
    registry.broadcast_status(
        app,
        session_id,
        STATUS_CONNECTING,
        Some(waiting.to_string()),
    );
    match timeout(SSH_PROMPT_TIMEOUT, responder_rx).await {
        Ok(Ok(answer)) => Ok(answer),
        Ok(Err(_)) | Err(_) => {
            registry.prompts.lock().remove(&prompt_id);
            Err("SSH 提示超时或被取消".to_string())
        }
    }
}
