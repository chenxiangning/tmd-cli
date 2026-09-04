//! SSH IO 泵 —— PTY shell 通道的双向转发。
//! 实现 ssh_io.rs:writer 任务消费输入(数据/resize),reader 循环
//! 把通道消息推 `pty://out/{id}` + 落会话日志;结束原因分类驱动重连或收尾。

use russh::client;
use russh::ChannelMsg;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use super::{SshRegistry, SshSessionInput, SshSessionRuntime};

#[derive(Debug, Clone, PartialEq, Eq)]
enum IoEndReason {
    /// 用户关闭(kill/应用退出):直接收尾。
    Shutdown,
    /// 输入通道关闭(条目被移除):直接收尾。
    InputClosed,
    /// 远端 shell 退出(exit/status)。
    RemoteExit(u32),
    /// 远端 shell 被信号杀死。
    RemoteExitSignal(String),
    /// 远端主动关闭通道。
    RemoteClosed,
    /// 连接断开(eof 前 None):探测后转重连。
    ConnectionLost,
    /// 写入失败:转重连。
    WriteFailed,
}

/// 向幕布事件流追加一段原始字节并落日志(重连提示等引擎侧文本也走此路)。
pub(crate) fn emit_output(app: &AppHandle, registry: &SshRegistry, session_id: &str, bytes: &[u8]) {
    let entry = match registry.sessions.lock().get(session_id).map(Arc::clone) {
        Some(entry) => entry,
        None => return,
    };
    if let (Some(file), Some(path)) = (entry.log_file.lock().as_mut(), entry.log_path.as_ref()) {
        if crate::session_log::append_log(&registry.logs, session_id, file, path, bytes).is_err() {
            *entry.log_file.lock() = None;
        }
    }
    let text = String::from_utf8_lossy(bytes).to_string();
    let _ = app.emit(&format!("pty://out/{session_id}"), text);
}

/* 泵参数为通道原语,聚合进结构反而隔靴搔痒 */
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_session_io(
    app: AppHandle,
    registry: Arc<SshRegistry>,
    session_id: String,
    runtime: Arc<SshSessionRuntime>,
    connection_id: usize,
    channel: russh::Channel<client::Msg>,
    mut input_rx: tokio::sync::mpsc::Receiver<SshSessionInput>,
    mut shutdown_rx: tokio::sync::mpsc::Receiver<()>,
) {
    let (mut read_half, write_half) = channel.split();
    let (writer_end_tx, mut writer_end_rx) = tokio::sync::mpsc::channel::<IoEndReason>(1);
    let writer_runtime = Arc::clone(&runtime);
    tokio::task::spawn(async move {
        let mut writer = write_half.make_writer();
        let reason = loop {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    let handle = writer_runtime.handle.lock().await;
                    if let Some(handle) = handle.as_ref() {
                        let _ = handle
                            .disconnect(russh::Disconnect::ByApplication, "用户断开", "zh")
                            .await;
                    }
                    break IoEndReason::Shutdown;
                }
                input = input_rx.recv() => {
                    match input {
                        Some(SshSessionInput::Data(data)) => {
                            if writer.write_all(&data).await.is_err() {
                                break IoEndReason::WriteFailed;
                            }
                        }
                        Some(SshSessionInput::Resize(cols, rows)) => {
                            let _ = write_half.window_change(u32::from(cols), u32::from(rows), 0, 0).await;
                        }
                        None => break IoEndReason::InputClosed,
                    }
                }
            }
        };
        let _ = writer_end_tx.send(reason).await;
    });

    let mut remote_exit: Option<IoEndReason> = None;
    let end_reason = loop {
        tokio::select! {
            reason = writer_end_rx.recv() => {
                break reason.unwrap_or(IoEndReason::InputClosed);
            }
            message = read_half.wait() => {
                match message {
                    Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                        emit_output(&app, &registry, &session_id, data.as_ref());
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        remote_exit = Some(IoEndReason::RemoteExit(exit_status));
                    }
                    Some(ChannelMsg::ExitSignal { signal_name, .. }) => {
                        remote_exit = Some(IoEndReason::RemoteExitSignal(format!("{signal_name:?}")));
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => {
                        break remote_exit.unwrap_or(IoEndReason::RemoteClosed);
                    }
                    None => {
                        break remote_exit.unwrap_or(IoEndReason::ConnectionLost);
                    }
                    _ => {}
                }
            }
        }
    };

    finish_session_io(
        app,
        registry,
        session_id,
        runtime,
        connection_id,
        end_reason,
    )
    .await;
}

async fn finish_session_io(
    app: AppHandle,
    registry: Arc<SshRegistry>,
    session_id: String,
    runtime: Arc<SshSessionRuntime>,
    connection_id: usize,
    end_reason: IoEndReason,
) {
    if runtime.is_closing() {
        return;
    }
    match end_reason {
        IoEndReason::Shutdown | IoEndReason::InputClosed => {
            /* kill 路径:kill 命令已负责收尾,这里只等泵退出。 */
        }
        IoEndReason::RemoteExit(status) => {
            emit_output(
                &app,
                &registry,
                &session_id,
                format!("\r\n[SSH] 远端 shell 退出(status {status})。\r\n").as_bytes(),
            );
            registry.broadcast_status(&app, &session_id, super::STATUS_DISCONNECTED, None);
            registry.finish_session(&app, &session_id);
        }
        IoEndReason::RemoteExitSignal(signal) => {
            emit_output(
                &app,
                &registry,
                &session_id,
                format!("\r\n[SSH] 远端 shell 被信号终止({signal})。\r\n").as_bytes(),
            );
            registry.broadcast_status(&app, &session_id, super::STATUS_DISCONNECTED, None);
            registry.finish_session(&app, &session_id);
        }
        IoEndReason::RemoteClosed => {
            emit_output(
                &app,
                &registry,
                &session_id,
                "\r\n[SSH] 远端 shell 已关闭。\r\n".as_bytes(),
            );
            registry.broadcast_status(&app, &session_id, super::STATUS_DISCONNECTED, None);
            registry.finish_session(&app, &session_id);
        }
        IoEndReason::ConnectionLost | IoEndReason::WriteFailed => {
            spawn_reconnect_runner(app, registry, session_id, runtime, connection_id);
        }
    }
}

/// 重连必须跑在 Tauri 常驻 runtime(russh 会话绑定当前 runtime)。
pub(crate) fn spawn_reconnect_runner(
    app: AppHandle,
    registry: Arc<SshRegistry>,
    session_id: String,
    runtime: Arc<SshSessionRuntime>,
    connection_id: usize,
) {
    tauri::async_runtime::spawn(async move {
        super::session::handle_unexpected_disconnect(
            app,
            registry,
            session_id,
            runtime,
            connection_id,
        )
        .await;
    });
}
