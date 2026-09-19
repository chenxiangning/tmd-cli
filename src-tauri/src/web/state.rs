//! Web 访问桥运行态:start/stop 线性化 + 「有浏览器在驾驶」计数。

use parking_lot::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::{oneshot, watch};

/// 存活浏览器 socket 数:>0 即「远程控制中」(徽标语义;M1 计全部 /ws 连接)。
static REMOTE_SOCKETS: AtomicU64 = AtomicU64::new(0);

pub(crate) fn remote_socket_count() -> u64 {
    REMOTE_SOCKETS.load(Ordering::SeqCst)
}

/// RAII 计数器:socket 存活期 +1,任何路径结束都 -1;0↔1 边沿发事件。
pub(super) struct RemoteSocket {
    app: tauri::AppHandle,
}

impl RemoteSocket {
    pub(super) fn enter(app: tauri::AppHandle) -> Self {
        if REMOTE_SOCKETS.fetch_add(1, Ordering::SeqCst) == 0 {
            emit_count(&app);
        }
        Self { app }
    }
}

impl Drop for RemoteSocket {
    fn drop(&mut self) {
        if REMOTE_SOCKETS.fetch_sub(1, Ordering::SeqCst) == 1 {
            emit_count(&self.app);
        }
    }
}

fn emit_count(app: &tauri::AppHandle) {
    crate::event_sink::emit(
        app,
        "web://remote-control",
        &serde_json::json!({ "count": REMOTE_SOCKETS.load(Ordering::SeqCst) }),
    );
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebAccessInfo {
    pub url: String,
    pub port: u16,
    pub token: String,
    pub lan_ip: String,
}

pub(super) struct Running {
    pub info: WebAccessInfo,
    shutdown: oneshot::Sender<()>,
    /// 服务任务退出信号(stop 后 server 任务真正结束,状态清理可观测)。
    stopped: watch::Sender<bool>,
}

#[derive(Default)]
pub(crate) struct WebAccessState {
    inner: Mutex<Option<Running>>,
    /// start/stop 互斥:连点/竞态下不会起两个 server 或停别人的 server。
    transition: tokio::sync::Mutex<()>,
}

impl WebAccessState {
    pub fn status(&self) -> Option<WebAccessInfo> {
        self.inner.lock().as_ref().map(|r| r.info.clone())
    }

    pub(super) async fn start_locked(&self) -> Result<tokio::sync::MutexGuard<'_, ()>, String> {
        Ok(self.transition.lock().await)
    }

    pub(super) fn publish(&self, running: Running) -> WebAccessInfo {
        let info = running.info.clone();
        *self.inner.lock() = Some(running);
        info
    }

    /// 已在运行:返回现有 info(token 不变,避免并发 start 把已分享链接作废)。
    pub(super) fn current(&self) -> Option<WebAccessInfo> {
        self.status()
    }

    pub(super) fn stop_running(&self) -> Result<(), String> {
        let Some(running) = self.inner.lock().take() else {
            return Ok(());
        };
        let _ = running.shutdown.send(());
        let _ = running.stopped.send(true);
        Ok(())
    }
}

pub(super) fn new_running(
    info: WebAccessInfo,
    shutdown: oneshot::Sender<()>,
    stopped: watch::Sender<bool>,
) -> Running {
    Running {
        info,
        shutdown,
        stopped,
    }
}
