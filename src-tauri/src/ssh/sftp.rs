//! SFTP 子系统 —— 在终端会话的已认证连接上开 sftp channel(不重认证)。
//! 通道按连接代际缓存,重连后自动失效重开。
//! 路径原语见 sftp_path.rs;读操作 → sftp_ops.rs;写操作 → sftp_write.rs;
//! 传输(上传/下载/进度/取消)见 sftp_transfer*.rs(文件规模铁则拆分)。

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use tauri::Emitter;

use super::SshRegistry;

pub(crate) const TRANSFER_BUFFER_BYTES: usize = 64 * 1024;
/// SFTP 事件通道(`ssh://sftp`),载荷 {kind, transfer}。
pub(crate) const SFTP_EVENT: &str = "ssh://sftp";

/// 操作入口 re-export:保持 super::sftp::{list, stat, …} 引用路径不变。
pub use super::sftp_ops::{list, read_text, stat};
pub(crate) use super::sftp_write::ensure_remote_dir;
pub use super::sftp_write::{delete, mkdir, rename, write_text};

/// 远端条目(树/编辑器/传输共用)。
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub path: String,
    pub name: String,
    /// "dir" | "file"。
    pub kind: String,
    pub size_bytes: u64,
    /// ms epoch(SFTP 秒粒度 × 1000)。
    pub mtime: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpReadText {
    pub path: String,
    pub content: String,
    pub offset: u64,
    pub bytes_read: usize,
    pub size_bytes: u64,
    pub truncated: bool,
    pub entry: SftpEntry,
}

/// 写回结果;conflict 变体携带当前条目供编辑器弹覆盖确认。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "action")]
pub enum SftpWriteOutcome {
    Written { entry: SftpEntry },
    Conflict { entry: Option<SftpEntry> },
}

/// 进程级 SFTP 注册表:会话 → (代际, channel)。
pub struct SftpRegistry {
    sessions: Mutex<HashMap<String, CachedSftp>>,
}

struct CachedSftp {
    connection_id: usize,
    session: Arc<tokio::sync::Mutex<SftpSession>>,
}

static SFTP: std::sync::LazyLock<SftpRegistry> = std::sync::LazyLock::new(|| SftpRegistry {
    sessions: Mutex::new(HashMap::new()),
});

pub(crate) fn global_sftp() -> &'static SftpRegistry {
    &SFTP
}

/// 会话终局级联:弃通道缓存、取消在途传输。
pub fn close_session(session_id: &str) {
    SFTP.sessions.lock().remove(session_id);
    super::sftp_transfer_state::cancel_session_transfers(session_id);
}

pub(crate) fn ssh_registry() -> Arc<SshRegistry> {
    super::global_ssh().expect("SSH 引擎未装配")
}

impl SftpRegistry {
    /// 弃缓存通道(连接失效后操作入口重试前调用)。
    pub(crate) fn invalidate(&self, session_id: &str) {
        self.sessions.lock().remove(session_id);
    }

    /// 取(或按代际重建)会话的 SFTP 通道。
    pub(crate) async fn session_for(
        &self,
        registry: &Arc<SshRegistry>,
        session_id: &str,
    ) -> Result<Arc<tokio::sync::Mutex<SftpSession>>, String> {
        let entry = registry.entry(session_id)?;
        if entry.runtime.status() != super::STATUS_CONNECTED {
            return Err("SSH 连接未就绪".to_string());
        }
        let connection_id = entry.runtime.current_connection_id();
        if let Some(cached) = self
            .sessions
            .lock()
            .get(session_id)
            .filter(|cached| cached.connection_id == connection_id)
            .map(|cached| Arc::clone(&cached.session))
        {
            return Ok(cached);
        }
        let handle = entry
            .runtime
            .current_handle()
            .await
            .ok_or_else(|| "SSH 连接不可用".to_string())?;
        let channel = handle
            .channel_open_session()
            .await
            .map_err(|error| format!("SFTP 通道打开失败: {error}"))?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|error| format!("SFTP subsystem 请求失败: {error}"))?;
        let session = SftpSession::new(channel.into_stream())
            .await
            .map_err(|error| format!("SFTP 会话建立失败: {error}"))?;
        let cached = Arc::new(tokio::sync::Mutex::new(session));
        self.sessions.lock().insert(
            session_id.to_string(),
            CachedSftp {
                connection_id,
                session: Arc::clone(&cached),
            },
        );
        Ok(cached)
    }
}

/// 广播传输事件(progress/done/failed/cancelled;状态表在 sftp_transfer_state)。
pub(crate) fn broadcast_transfer(
    kind: &str,
    transfer: &super::sftp_transfer_state::SftpTransferState,
) {
    let Some(app) = super::global_app() else {
        return;
    };
    let _ = app.emit(
        SFTP_EVENT,
        SftpEventPayload {
            kind: kind.to_string(),
            transfer: transfer.clone(),
        },
    );
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SftpEventPayload {
    kind: String,
    transfer: super::sftp_transfer_state::SftpTransferState,
}
