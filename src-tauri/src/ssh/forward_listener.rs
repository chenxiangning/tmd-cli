//! SSH 端口转发监听任务 —— accept 循环、信号量限流、单连接双向拷贝。
//! 自 forward.rs 拆出(文件规模铁则);转发注册表与启停入口留在 forward.rs。

use std::sync::Arc;

use tokio::io::{copy_bidirectional, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{watch, Semaphore};
use tokio::task::JoinSet;
use tokio::time::timeout;

use super::forward::global_forwards;

/// 远端通道打开超时。
const CHANNEL_OPEN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_listener(
    session_id: String,
    forward_id: String,
    listener: TcpListener,
    runtime: Arc<super::SshSessionRuntime>,
    remote_host: String,
    remote_port: u16,
    mut cancel_rx: watch::Receiver<bool>,
    forward_connections: Arc<Semaphore>,
    global_connections: Arc<Semaphore>,
) {
    let mut connections = JoinSet::new();
    let listener_error = loop {
        tokio::select! {
            changed = cancel_rx.changed() => {
                if changed.is_err() || *cancel_rx.borrow() {
                    break None;
                }
            }
            accepted = listener.accept() => {
                let (stream, peer_addr) = match accepted {
                    Ok(value) => value,
                    Err(error) => break Some(format!("转发监听失败: {error}")),
                };
                let Ok(forward_permit) = Arc::clone(&forward_connections).try_acquire_owned() else {
                    drop(stream);
                    continue;
                };
                let Ok(global_permit) = Arc::clone(&global_connections).try_acquire_owned() else {
                    drop(stream);
                    drop(forward_permit);
                    continue;
                };
                let runtime = Arc::clone(&runtime);
                let remote_host = remote_host.clone();
                let connection_cancel_rx = cancel_rx.clone();
                connections.spawn(async move {
                    let _forward_permit = forward_permit;
                    let _global_permit = global_permit;
                    run_connection(
                        stream,
                        peer_addr,
                        runtime,
                        remote_host,
                        remote_port,
                        connection_cancel_rx,
                    )
                    .await;
                });
            }
            completed = connections.join_next(), if !connections.is_empty() => {
                let _ = completed;
            }
        }
    };
    connections.abort_all();
    while connections.join_next().await.is_some() {}

    if let Some(error) = listener_error {
        global_forwards().fail(&forward_id, &session_id, error);
    }
}

async fn run_connection(
    mut local_stream: TcpStream,
    peer_addr: std::net::SocketAddr,
    runtime: Arc<super::SshSessionRuntime>,
    remote_host: String,
    remote_port: u16,
    mut cancel_rx: watch::Receiver<bool>,
) {
    let _ = local_stream.set_nodelay(true);
    if *cancel_rx.borrow() || runtime.is_closing() {
        return;
    }
    /* 克隆 handle 再拨号:不占连接锁等超时。 */
    let Some(handle) = runtime.current_handle().await else {
        return;
    };
    let channel = match timeout(
        CHANNEL_OPEN_TIMEOUT,
        handle.channel_open_direct_tcpip(
            remote_host,
            u32::from(remote_port),
            peer_addr.ip().to_string(),
            u32::from(peer_addr.port()),
        ),
    )
    .await
    {
        Ok(Ok(channel)) => channel,
        Ok(Err(_)) | Err(_) => return,
    };
    let mut ssh_stream = channel.into_stream();
    tokio::select! {
        _ = copy_bidirectional(&mut local_stream, &mut ssh_stream) => {}
        _ = cancel_rx.changed() => {}
    }
    let _ = local_stream.shutdown().await;
    let _ = ssh_stream.shutdown().await;
}
