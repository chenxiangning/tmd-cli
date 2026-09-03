//! SSH 会话编排 —— 创建/提示应答/重连/输入/断开。
//! 移植参考实现 ssh_session.rs 的状态机,tmd-cli 化:
//! - 创建即返回会话 id(连接在后台任务完成,状态经 ssh://event 流转);
//! - 提示(host key/KBI/密码回落)经 ssh://prompt 事件 + oneshot 邮箱,
//!   连接任务全程持有状态机,应答命令只投递答案(120s 超时 = 拒绝);
//! - 会话终局发 pty://exit,遵循 tmd-cli「退出即消亡」语义。

use russh::client;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::time::timeout;

use super::auth::{
    authenticate_ssh_handle, continue_keyboard_interactive_auth, password_fallback_authenticate,
    resolve_ssh_auth_material, KeyboardInteractivePromptData, ResolvedSshAuth, SshAuthOutcome,
    SshPromptAnswerMode,
};
use super::io::{emit_output, run_session_io};
use super::known_hosts;
use super::transport::{connect_ssh_handle, CapturedHostKey, SshClient};
use super::{
    PendingPrompt, PromptAnswer, SshPromptEvent, SshRegistry, SshSessionEntry, SshSessionInput,
    SSH_DEFAULT_COLS, SSH_DEFAULT_ROWS, SSH_PROMPT_TIMEOUT, SSH_RECONNECT_ATTEMPT_TIMEOUT,
    SSH_RECONNECT_DELAYS, SSH_RECONNECT_MAX_ATTEMPTS, STATUS_CONNECTED, STATUS_CONNECTING,
    STATUS_FAILED, STATUS_RECONNECTING,
};

/// 打开 PTY shell 通道(移植参考实现 open_shell_channel)。
async fn open_shell_channel(
    handle: &client::Handle<SshClient>,
    cols: u16,
    rows: u16,
) -> Result<russh::Channel<client::Msg>, String> {
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|error| format!("SSH 通道打开失败: {error}"))?;
    channel
        .request_pty(
            false,
            "xterm-256color",
            u32::from(cols),
            u32::from(rows),
            0,
            0,
            &[],
        )
        .await
        .map_err(|error| format!("SSH PTY 请求失败: {error}"))?;
    channel
        .request_shell(false)
        .await
        .map_err(|error| format!("SSH shell 请求失败: {error}"))?;
    Ok(channel)
}

/// 后台连接任务:create 命令注册条目后立即返回,这里完成全流程。
pub(crate) async fn connect_and_run(
    app: AppHandle,
    registry: Arc<SshRegistry>,
    session_id: String,
) {
    let entry = match registry.entry(&session_id) {
        Ok(entry) => entry,
        Err(_) => return,
    };
    registry.broadcast_status(&app, &session_id, STATUS_CONNECTING, None);
    match run_connect(&app, &registry, &session_id, &entry).await {
        Ok(handle) => {
            if let Err(error) =
                install_connected(&app, &registry, &session_id, &entry, handle).await
            {
                fail_session(&app, &registry, &session_id, &error);
            }
        }
        Err(error) => fail_session(&app, &registry, &session_id, &error),
    }
}

fn fail_session(app: &AppHandle, registry: &SshRegistry, session_id: &str, error: &str) {
    registry.broadcast_status(app, session_id, STATUS_FAILED, Some(error.to_string()));
    registry.finish_session(app, session_id);
}

/// 认证推进动作:认证材料 / KBI 应答 / 密码回落,单一循环消费。
enum AuthAction {
    Authenticate(ResolvedSshAuth),
    KbiRespond(String),
    PasswordFallback(String),
}

impl ResolvedSshAuth {
    /// 认证材料可重复取用(重试轮次用副本,密码克隆成本可忽略)。
    fn clone_resolved(&self) -> ResolvedSshAuth {
        match self {
            ResolvedSshAuth::Password(password) => ResolvedSshAuth::Password(password.clone()),
            ResolvedSshAuth::PrivateKey { key, passphrase } => ResolvedSshAuth::PrivateKey {
                key: key.clone(),
                passphrase: passphrase.clone(),
            },
            ResolvedSshAuth::KeyboardInteractive => ResolvedSshAuth::KeyboardInteractive,
        }
    }
}

/// 连接 + 认证全流程(host key 信任流与 KBI/密码回落轮次),返回已认证 handle。
/// 每轮循环最多一次用户交互;轮次上限统一收敛到 SSH_KBI_MAX_ROUNDS。
async fn run_connect(
    app: &AppHandle,
    registry: &SshRegistry,
    session_id: &str,
    entry: &Arc<SshSessionEntry>,
) -> Result<client::Handle<SshClient>, String> {
    let host = entry.host.normalized()?;
    let auth = resolve_ssh_auth_material(&host)?;
    let mut host_key_prompted = false;

    loop {
        let captured = Arc::new(tokio::sync::Mutex::new(None::<CapturedHostKey>));
        let mut handle = match connect_ssh_handle(&host, Arc::clone(&captured)).await {
            Ok(handle) => handle,
            Err(error) => {
                let Some(captured) = captured.lock().await.clone() else {
                    return Err(error);
                };
                if host_key_prompted {
                    return Err("SSH 主机密钥确认后仍无法建立连接".to_string());
                }
                host_key_prompted = true;
                if !ask_host_key(app, registry, session_id, captured).await? {
                    return Err("SSH 主机密钥未获信任".to_string());
                }
                continue;
            }
        };

        let mut pending: Option<AuthAction> = None;
        for _ in 0..=super::SSH_KBI_MAX_ROUNDS {
            let action = pending
                .take()
                .unwrap_or_else(|| AuthAction::Authenticate(auth.clone_resolved()));
            match action {
                AuthAction::Authenticate(material) => {
                    match authenticate_ssh_handle(&mut handle, &host, material).await? {
                        SshAuthOutcome::Authenticated => return Ok(handle),
                        SshAuthOutcome::KeyboardInteractivePrompt(data) => {
                            pending =
                                Some(ask_user_then_plan(app, registry, session_id, &data).await?);
                        }
                    }
                }
                AuthAction::KbiRespond(value) => {
                    let response = handle
                        .authenticate_keyboard_interactive_respond(vec![value])
                        .await
                        .map_err(|error| format!("SSH 键盘交互应答失败: {error}"))?;
                    match continue_keyboard_interactive_auth(&mut handle, response, None).await? {
                        SshAuthOutcome::Authenticated => return Ok(handle),
                        SshAuthOutcome::KeyboardInteractivePrompt(data) => {
                            pending =
                                Some(ask_user_then_plan(app, registry, session_id, &data).await?);
                        }
                    }
                }
                AuthAction::PasswordFallback(value) => {
                    match password_fallback_authenticate(&mut handle, &host, &value).await? {
                        SshAuthOutcome::Authenticated => return Ok(handle),
                        /* 密码回落失败会再给一次重试提示;本轮应答后继续,由循环上限收敛。 */
                        SshAuthOutcome::KeyboardInteractivePrompt(data) => {
                            pending =
                                Some(ask_user_then_plan(app, registry, session_id, &data).await?);
                        }
                    }
                }
            }
        }
        return Err("SSH 认证交互轮次超限".to_string());
    }
}

/// 一次用户交互:发提示 → 等应答 → 按应答模式规划下一动作。
async fn ask_user_then_plan(
    app: &AppHandle,
    registry: &SshRegistry,
    session_id: &str,
    data: &KeyboardInteractivePromptData,
) -> Result<AuthAction, String> {
    let event = SshPromptEvent {
        prompt_id: String::new(),
        kind: match data.answer_mode {
            SshPromptAnswerMode::Password => "password".to_string(),
            SshPromptAnswerMode::KeyboardInteractive => "kbi".to_string(),
        },
        key_type: None,
        fingerprint: None,
        stored_fingerprint: None,
        name: (!data.name.is_empty()).then(|| data.name.clone()),
        instructions: (!data.instructions.is_empty()).then(|| data.instructions.clone()),
        prompt: Some(data.prompt.clone()),
        echo: data.echo,
    };
    let answer = ask_user(app, registry, session_id, event).await?;
    let value = answer.answer.unwrap_or_default();
    Ok(match data.answer_mode {
        SshPromptAnswerMode::Password => AuthAction::PasswordFallback(value),
        SshPromptAnswerMode::KeyboardInteractive => AuthAction::KbiRespond(value),
    })
}

/// host key 信任流:发提示 → 等 oneshot;信任则落库,拒绝/超时返回 false/Err。
async fn ask_host_key(
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
async fn ask_user(
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
    match timeout(SSH_PROMPT_TIMEOUT, responder_rx).await {
        Ok(Ok(answer)) => Ok(answer),
        Ok(Err(_)) | Err(_) => {
            registry.prompts.lock().remove(&prompt_id);
            Err("SSH 提示超时或被取消".to_string())
        }
    }
}

/// 已认证:开 shell 通道、装配运行时、启动 IO 泵、广播 connected。
async fn install_connected(
    app: &AppHandle,
    registry: &Arc<SshRegistry>,
    session_id: &str,
    entry: &Arc<SshSessionEntry>,
    handle: client::Handle<SshClient>,
) -> Result<(), String> {
    let cols = u16::try_from(entry.cols.load(std::sync::atomic::Ordering::SeqCst))
        .unwrap_or(SSH_DEFAULT_COLS);
    let rows = u16::try_from(entry.rows.load(std::sync::atomic::Ordering::SeqCst))
        .unwrap_or(SSH_DEFAULT_ROWS);
    let channel = open_shell_channel(&handle, cols, rows).await?;
    let (input_tx, input_rx) = tokio::sync::mpsc::channel::<SshSessionInput>(256);
    let (shutdown_tx, shutdown_rx) = tokio::sync::mpsc::channel::<()>(1);
    let connection_id = entry
        .runtime
        .install_connection(handle, input_tx, shutdown_tx)
        .await;
    if entry.runtime.is_closing() {
        entry
            .runtime
            .clear_connection_if_current(connection_id)
            .await;
        return Err("SSH 会话正在关闭".to_string());
    }
    registry.broadcast_status(app, session_id, STATUS_CONNECTED, None);
    let app = app.clone();
    let registry = Arc::clone(registry);
    let runtime = Arc::clone(&entry.runtime);
    let id = session_id.to_string();
    tauri::async_runtime::spawn(async move {
        run_session_io(
            app,
            registry,
            id,
            runtime,
            connection_id,
            channel,
            input_rx,
            shutdown_rx,
        )
        .await;
    });
    Ok(())
}

/// 意外断线的有界重连(移植参考实现 handle_ssh_unexpected_disconnect)。
pub(crate) async fn handle_unexpected_disconnect(
    app: AppHandle,
    registry: Arc<SshRegistry>,
    session_id: String,
    runtime: Arc<super::SshSessionRuntime>,
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
        super::STATUS_DISCONNECTED,
        Some(format!("自动重连 {SSH_RECONNECT_MAX_ATTEMPTS} 次未成功")),
    );
    registry.finish_session(&app, &session_id);
    runtime.finish_reconnect_runner();
}

/// 单次重连:静默建连(host key 必须 Known;KBI 主机自动重连不支持,参考实现同款纪律)。
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

#[cfg(test)]
/// 端到端测试用:直接暴露通道打开(测试自行 split 读写)。
pub(crate) async fn open_shell_channel_for_test(
    handle: &client::Handle<SshClient>,
    cols: u16,
    rows: u16,
) -> Result<russh::Channel<client::Msg>, String> {
    open_shell_channel(handle, cols, rows).await
}
