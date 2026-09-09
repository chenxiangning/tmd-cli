//! SSH 会话引擎 —— tmd-cli 的一等会话后端(russh)。
//!
//! 每个会话 = 一条 russh 连接 + 一个 PTY shell 通道。输出以与 PTY 完全
//! 同构的事件契约(`pty://out/{id}` / `pty://exit/{id}`)驱动幕布,
//! 增强面(状态/提示/转发/SFTP)走独立事件 `ssh://event/{id}`、
//! `ssh://prompt/{id}`,绝不混入幕布字节流。
//!
//! 拆分边界(文件规模铁则):
//! - 传输/代理/host key 捕获 → transport.rs;
//! - 认证材料/KBI 多轮 → auth.rs;
//! - known_hosts JSON 存储 → known_hosts.rs;
//! - 连接编排/重连 → session.rs;IO 泵 → io.rs;
//! - SFTP 子系统 → sftp.rs;本地端口转发 → forward.rs;
//! - Tauri 命令 → commands.rs。

use std::collections::HashMap;
use std::sync::atomic::AtomicUsize;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::session_log::LogMeta;

pub mod auth;
mod auth_material;
pub mod commands;
pub mod control;
#[cfg(test)]
mod e2e_tests;
pub mod forward;
mod forward_listener;
pub mod io;
pub mod known_hosts;
pub mod proxy;
mod proxy_handshake;
mod runtime;
pub mod session;
mod session_prompt;
mod session_reconnect;
pub mod sftp;
mod sftp_download;
mod sftp_ops;
pub mod sftp_path;
pub mod sftp_transfer;
pub mod sftp_transfer_state;
mod sftp_upload;
mod sftp_write;
pub mod transport;

pub(crate) use self::runtime::{SshSessionInput, SshSessionRuntime};

/// keepalive:30s 间隔 × 3 次未响应判死。
pub(crate) const SSH_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(30);
pub(crate) const SSH_KEEPALIVE_MAX_MISSES: usize = 3;
/// 自动重连:3 次,2/5/10s 退避,单次尝试 20s 超时。
pub(crate) const SSH_RECONNECT_MAX_ATTEMPTS: u8 = 3;
pub(crate) const SSH_RECONNECT_DELAYS: [Duration; 3] = [
    Duration::from_secs(2),
    Duration::from_secs(5),
    Duration::from_secs(10),
];
pub(crate) const SSH_RECONNECT_ATTEMPT_TIMEOUT: Duration = Duration::from_secs(20);
/// host key / KBI 提示等待上限:超时视为拒绝。
pub(crate) const SSH_PROMPT_TIMEOUT: Duration = Duration::from_secs(120);
/// KBI 多轮上限。
pub(crate) const SSH_KBI_MAX_ROUNDS: usize = 5;
/// 默认 PTY 尺寸(与 pty.rs default_cols/default_rows 一致)。
pub(crate) const SSH_DEFAULT_COLS: u16 = 120;
pub(crate) const SSH_DEFAULT_ROWS: u16 = 32;

pub(crate) const STATUS_CONNECTING: &str = "connecting";
pub(crate) const STATUS_CONNECTED: &str = "connected";
pub(crate) const STATUS_RECONNECTING: &str = "reconnecting";
pub(crate) const STATUS_DISCONNECTED: &str = "disconnected";
pub(crate) const STATUS_FAILED: &str = "failed";

/// 进程级全局注入(应用启动装配一次):AppHandle + SshRegistry 弱引用。
/// forward/sftp 的后台任务与监听器从这里取回注册表,避免到处传 Arc。
struct Globals {
    app: Mutex<Option<AppHandle>>,
    ssh: Mutex<std::sync::Weak<SshRegistry>>,
}

static GLOBALS: std::sync::LazyLock<Globals> = std::sync::LazyLock::new(|| Globals {
    app: Mutex::new(None),
    ssh: Mutex::new(std::sync::Weak::new()),
});

/// 命令层装配入口(lib.rs setup 调一次);测试可只注入注册表。
pub fn attach_globals(app: Option<&AppHandle>, registry: &Arc<SshRegistry>) {
    if let Some(app) = app {
        *GLOBALS.app.lock() = Some(app.clone());
    }
    *GLOBALS.ssh.lock() = Arc::downgrade(registry);
}

pub(crate) fn global_app() -> Option<AppHandle> {
    GLOBALS.app.lock().clone()
}

pub(crate) fn global_ssh() -> Option<Arc<SshRegistry>> {
    GLOBALS.ssh.lock().upgrade()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SshSessionEvent {
    Status(SshStatusEvent),
    Forwards {
        forwards: Vec<forward::SshForwardInfo>,
    },
}

/// 会话状态事件(Status 变体的载荷)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshStatusEvent {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub reconnect_attempt: u32,
    pub reconnect_max_attempts: u8,
}

/// 提示事件(`ssh://prompt/{id}`):host key 信任 / KBI 应答 / 密码回落。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshPromptEvent {
    pub prompt_id: String,
    /// "hostKey" | "kbi" | "password"。
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
    /// host key 变更时已存指纹(危险提示)。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stored_fingerprint: Option<String>,
    /// KBI 名称/说明/问题文本。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    /// KBI 单提示是否回显。
    #[serde(default)]
    pub echo: bool,
}

/// 一个 SSH 会话条目:主机配置快照(重连用)+ 运行时 + 会话日志句柄。
pub(crate) struct SshSessionEntry {
    pub(crate) host: transport::SshHostWire,
    pub(crate) runtime: Arc<SshSessionRuntime>,
    pub(crate) cols: AtomicUsize,
    pub(crate) rows: AtomicUsize,
    /// 会话输出日志句柄与路径(翻页数据源,创建失败= None,能力降级不阻塞)。
    pub(crate) log_file: Mutex<Option<std::fs::File>>,
    pub(crate) log_path: Option<std::path::PathBuf>,
}

/// 待应答提示:连接任务在后台等待 oneshot 应答。
/// 邮箱式 —— 状态机全程在连接任务内,提示种类只对前端有意义(hostKey/kbi/password)。
pub(crate) struct PendingPrompt {
    pub(crate) responder: tokio::sync::oneshot::Sender<PromptAnswer>,
}

pub(crate) struct PromptAnswer {
    pub(crate) answer: Option<String>,
    pub(crate) trust_host_key: bool,
}

/// SSH 注册表:进程内存态(与 SessionRegistry 同生命周期)。
#[derive(Default)]
pub struct SshRegistry {
    pub(crate) sessions: Mutex<HashMap<String, Arc<SshSessionEntry>>>,
    pub(crate) prompts: Mutex<HashMap<String, Arc<PendingPrompt>>>,
    /// 会话日志账本(append_log/read_history_page 的共享原语,与 PtyRegistry.logs 同构)。
    pub(crate) logs: Arc<Mutex<HashMap<String, LogMeta>>>,
}

impl SshRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub(crate) fn entry(&self, session_id: &str) -> Result<Arc<SshSessionEntry>, String> {
        self.sessions
            .lock()
            .get(session_id)
            .map(Arc::clone)
            .ok_or_else(|| format!("SSH 会话不存在: {session_id}"))
    }

    pub(crate) fn contains(&self, session_id: &str) -> bool {
        self.sessions.lock().contains_key(session_id)
    }

    /// 广播状态事件(写运行时状态 + 发事件,一次一致)。
    pub(crate) fn broadcast_status(
        &self,
        app: &AppHandle,
        session_id: &str,
        status: &str,
        message: Option<String>,
    ) {
        if let Some(entry) = self.sessions.lock().get(session_id) {
            *entry.runtime.status.lock() = status.to_string();
        }
        let _ = app.emit(
            &format!("ssh://event/{session_id}"),
            SshSessionEvent::Status(SshStatusEvent {
                status: status.to_string(),
                message,
                reconnect_attempt: 0,
                reconnect_max_attempts: SSH_RECONNECT_MAX_ATTEMPTS,
            }),
        );
    }

    /// 会话终局:注销条目、级联停转发/SFTP、清日志、发 pty://exit(幕布链路收尾)。
    pub(crate) fn finish_session(&self, app: &AppHandle, session_id: &str) {
        forward::global_forwards().cancel_session(session_id);
        sftp::close_session(session_id);
        let entry = self.sessions.lock().remove(session_id);
        if let Some(entry) = entry {
            if let Some(meta) = self.logs.lock().remove(session_id) {
                let _ = std::fs::remove_file(meta.path);
            }
            entry.log_file.lock().take();
        }
        let _ = app.emit(&format!("pty://exit/{session_id}"), ());
    }
}
