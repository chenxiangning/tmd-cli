//! SSH 会话运行时 —— 连接代际 + 输入/关闭通道 + 重连互斥。
//! 自 mod.rs 拆出(文件规模铁则):SshSessionRuntime 状态机与 SshSessionInput 指令。

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;
use russh::client;

use super::transport;
use super::STATUS_CONNECTING;

/// 一次 SSH 会话的运行时(连接代际 + 输入/关闭通道 + 重连互斥)。
/// 实现 SshSessionRuntime:代际 id 防旧通道写入新连接。
pub(crate) struct SshSessionRuntime {
    /// Arc 包裹:转发/SFTP 等短通道操作克隆后即释放锁再 await 拨号。
    pub(crate) handle: tokio::sync::Mutex<Option<Arc<client::Handle<transport::SshClient>>>>,
    pub(crate) input_tx: Mutex<Option<tokio::sync::mpsc::Sender<SshSessionInput>>>,
    pub(crate) shutdown_tx: Mutex<Option<tokio::sync::mpsc::Sender<()>>>,
    pub(crate) connection_id: AtomicUsize,
    pub(crate) closing: AtomicBool,
    pub(crate) reconnect_runner_active: AtomicBool,
    /// 当前状态(connecting/connected/…),状态广播与查询共用。
    pub(crate) status: Mutex<String>,
}

pub(crate) enum SshSessionInput {
    Data(Vec<u8>),
    Resize(u16, u16),
}

impl SshSessionRuntime {
    pub(crate) fn new() -> Self {
        Self {
            handle: tokio::sync::Mutex::new(None),
            input_tx: Mutex::new(None),
            shutdown_tx: Mutex::new(None),
            connection_id: AtomicUsize::new(0),
            closing: AtomicBool::new(false),
            reconnect_runner_active: AtomicBool::new(false),
            status: Mutex::new(STATUS_CONNECTING.to_string()),
        }
    }

    pub(crate) async fn install_connection(
        &self,
        handle: client::Handle<transport::SshClient>,
        input_tx: tokio::sync::mpsc::Sender<SshSessionInput>,
        shutdown_tx: tokio::sync::mpsc::Sender<()>,
    ) -> usize {
        let connection_id = self.connection_id.fetch_add(1, Ordering::SeqCst) + 1;
        *self.handle.lock().await = Some(Arc::new(handle));
        *self.input_tx.lock() = Some(input_tx);
        *self.shutdown_tx.lock() = Some(shutdown_tx);
        connection_id
    }

    pub(crate) async fn clear_connection_if_current(&self, connection_id: usize) {
        if self.connection_id.load(Ordering::SeqCst) != connection_id {
            return;
        }
        *self.handle.lock().await = None;
        *self.input_tx.lock() = None;
        *self.shutdown_tx.lock() = None;
    }

    pub(crate) async fn current_handle(&self) -> Option<Arc<client::Handle<transport::SshClient>>> {
        self.handle.lock().await.as_ref().map(Arc::clone)
    }

    pub(crate) fn input_sender(&self) -> Option<tokio::sync::mpsc::Sender<SshSessionInput>> {
        self.input_tx.lock().clone()
    }

    pub(crate) fn shutdown_sender(&self) -> Option<tokio::sync::mpsc::Sender<()>> {
        self.shutdown_tx.lock().clone()
    }

    /// 标记关闭并取回关闭通道发送端;随后的 IO 泵以 Shutdown 收尾。
    pub(crate) fn close(&self) -> Option<tokio::sync::mpsc::Sender<()>> {
        self.closing.store(true, Ordering::SeqCst);
        self.shutdown_sender()
    }

    pub(crate) fn is_closing(&self) -> bool {
        self.closing.load(Ordering::SeqCst)
    }

    pub(crate) fn current_connection_id(&self) -> usize {
        self.connection_id.load(Ordering::SeqCst)
    }

    pub(crate) fn begin_reconnect_runner(&self) -> bool {
        !self.reconnect_runner_active.swap(true, Ordering::SeqCst)
    }

    pub(crate) fn finish_reconnect_runner(&self) {
        self.reconnect_runner_active.store(false, Ordering::SeqCst);
    }

    pub(crate) fn status(&self) -> String {
        self.status.lock().clone()
    }
}
