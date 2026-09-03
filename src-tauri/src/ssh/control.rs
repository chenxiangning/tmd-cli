//! SSH 会话控制面 —— 提示应答/输入/resize/断开/延迟探测(命令层入口)。
//! 连接状态机在 session.rs;这里只做注册表操作,不碰 russh 生命周期。

use std::time::Duration;
use tauri::AppHandle;
use tokio::time::timeout;

use super::{PromptAnswer, SshRegistry, SshSessionInput};

/// 提示应答命令入口:唤醒等待中的连接任务(oneshot 邮箱投递)。
pub(crate) fn answer_prompt(
    registry: &SshRegistry,
    prompt_id: &str,
    answer: Option<String>,
    trust_host_key: bool,
) -> Result<(), String> {
    let prompt_id = prompt_id.trim().to_string();
    if prompt_id.is_empty() {
        return Err("prompt_id 不能为空".to_string());
    }
    let pending = registry
        .prompts
        .lock()
        .remove(&prompt_id)
        .ok_or_else(|| format!("SSH 提示不存在或已过期: {prompt_id}"))?;
    let pending =
        std::sync::Arc::try_unwrap(pending).map_err(|_| "SSH 提示应答通道已被占用".to_string())?;
    let _ = pending.responder.send(PromptAnswer {
        answer,
        trust_host_key,
    });
    Ok(())
}

/// 提示取消(前端 overlay 关闭):等价于拒绝应答。
pub(crate) fn cancel_prompt(registry: &SshRegistry, prompt_id: &str) -> Result<(), String> {
    answer_prompt(registry, prompt_id, None, false)
}

/// 会话输入写入口(命令层调用)。
pub(crate) fn write_input(
    registry: &SshRegistry,
    session_id: &str,
    data: &str,
) -> Result<(), String> {
    let entry = registry.entry(session_id)?;
    let sender = entry
        .runtime
        .input_sender()
        .ok_or_else(|| "SSH 会话未连接".to_string())?;
    sender
        .try_send(SshSessionInput::Data(data.as_bytes().to_vec()))
        .map_err(|_| "SSH 输入通道已满或关闭".to_string())
}

/// resize(命令层调用);通道未就绪时只记尺寸,连接后按此开 PTY。
pub(crate) fn resize(
    registry: &SshRegistry,
    session_id: &str,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let entry = registry.entry(session_id)?;
    entry
        .cols
        .store(usize::from(cols), std::sync::atomic::Ordering::SeqCst);
    entry
        .rows
        .store(usize::from(rows), std::sync::atomic::Ordering::SeqCst);
    if let Some(sender) = entry.runtime.input_sender() {
        let _ = sender.try_send(SshSessionInput::Resize(cols, rows));
    }
    Ok(())
}

/// 用户断开(命令层调用):标记关闭 → 通知泵 → 收尾发 pty://exit。
pub(crate) fn kill(
    app: &AppHandle,
    registry: &SshRegistry,
    session_id: &str,
) -> Result<(), String> {
    let entry = registry.entry(session_id)?;
    if let Some(shutdown) = entry.runtime.close() {
        let _ = shutdown.try_send(());
    }
    registry.finish_session(app, session_id);
    Ok(())
}

/// 延迟探测(右栏面板轮询):当前连接 ping 一次。
pub(crate) async fn latency(registry: &SshRegistry, session_id: &str) -> Result<u32, String> {
    let entry = registry.entry(session_id)?;
    let handle = entry
        .runtime
        .current_handle()
        .await
        .ok_or_else(|| "SSH 连接不可用".to_string())?;
    let start = std::time::Instant::now();
    timeout(Duration::from_secs(3), handle.send_ping())
        .await
        .map_err(|_| "SSH 延迟探测超时".to_string())?
        .map_err(|error| format!("SSH 延迟探测失败: {error}"))?;
    Ok(start.elapsed().as_millis().clamp(1, u128::from(u32::MAX)) as u32)
}
