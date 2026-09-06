//! SSH 本地端口转发(`-L`)—— 会话级注册表 + 监听任务。
//! 127.0.0.1 绑定、localPort 0 自动分配、
//! watch 取消、信号量限流、会话关闭级联停止。
//! 监听 accept 循环与单连接拷贝 → forward_listener.rs(文件规模铁则)。

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::Arc;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::Emitter;
use tokio::net::TcpListener;
use tokio::sync::{watch, Semaphore};

use super::forward_listener::run_listener;

const LOCAL_FORWARD_HOST: &str = "127.0.0.1";
const MAX_HOST_BYTES: usize = 255;
/// 单转发并发连接上限。
const MAX_CONNECTIONS_PER_FORWARD: usize = 16;
/// 全部转发合计并发连接上限。
const MAX_GLOBAL_CONNECTIONS: usize = 128;
/// 自动分配起始端口(IANA 动态端口段)。
const AUTO_PORT_START: u16 = 49152;

/// 一条转发(序列化给前端;事件快照与命令应答共用)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshForwardInfo {
    pub id: String,
    pub session_id: String,
    pub local_host: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    /// started | failed。
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

struct ForwardEntry {
    info: SshForwardInfo,
    cancel_tx: watch::Sender<bool>,
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

#[derive(Default)]
struct ForwardState {
    revision: u64,
    entries: HashMap<String, Arc<ForwardEntry>>,
}

/// 进程级转发注册表单例(git/mod.rs REPO_CACHE 同款 LazyLock)。
pub struct SshForwardRegistry {
    state: parking_lot::Mutex<ForwardState>,
    global_connections: Arc<Semaphore>,
}

static FORWARDS: std::sync::LazyLock<SshForwardRegistry> =
    std::sync::LazyLock::new(|| SshForwardRegistry {
        state: parking_lot::Mutex::new(ForwardState::default()),
        global_connections: Arc::new(Semaphore::new(MAX_GLOBAL_CONNECTIONS)),
    });

pub fn global_forwards() -> &'static SshForwardRegistry {
    &FORWARDS
}

impl SshForwardRegistry {
    /// 停掉某会话的全部转发(会话关闭级联)。
    pub fn cancel_session(&self, session_id: &str) {
        let entries: Vec<Arc<ForwardEntry>> = self
            .state
            .lock()
            .entries
            .values()
            .filter(|entry| entry.info.session_id == session_id)
            .map(Arc::clone)
            .collect();
        for entry in entries {
            self.stop_entry(&entry);
        }
    }

    pub fn list(&self, session_id: &str) -> Vec<SshForwardInfo> {
        let mut forwards: Vec<SshForwardInfo> = self
            .state
            .lock()
            .entries
            .values()
            .filter(|entry| entry.info.session_id == session_id)
            .map(|entry| entry.info.clone())
            .collect();
        forwards.sort_by(|a, b| a.id.cmp(&b.id));
        forwards
    }

    /// 启动一条转发;local_port 传 None = 自动分配(49152+ 顺序探测)。
    pub async fn start(
        &self,
        session_id: &str,
        remote_host: String,
        remote_port: u16,
        local_port: Option<u16>,
    ) -> Result<SshForwardInfo, String> {
        let registry = super::global_ssh().ok_or_else(|| "SSH 引擎未就绪".to_string())?;
        let entry = registry.entry(session_id)?;
        if entry.runtime.is_closing() {
            return Err("SSH 会话正在关闭".to_string());
        }
        if entry.runtime.status() != super::STATUS_CONNECTED {
            return Err("SSH 连接未就绪,无法开端口转发".to_string());
        }
        let remote_host = normalize_remote_host(&remote_host)?;
        normalize_remote_port(remote_port)?;

        let local_port = match local_port {
            Some(port) => {
                if port == 0 {
                    return Err("本地端口不能为 0".to_string());
                }
                port
            }
            None => pick_free_port().await?,
        };
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, local_port))
            .await
            .map_err(|error| format!("本地端口 {local_port} 绑定失败: {error}"))?;

        let forward_id = crate::pty::uuid_v4();
        let info = SshForwardInfo {
            id: forward_id.clone(),
            session_id: session_id.to_string(),
            local_host: LOCAL_FORWARD_HOST.to_string(),
            local_port,
            remote_host,
            remote_port,
            status: "started".to_string(),
            error: None,
        };
        let (cancel_tx, cancel_rx) = watch::channel(false);
        let returned = info.clone();
        let task = tauri::async_runtime::spawn(run_listener(
            session_id.to_string(),
            forward_id.clone(),
            listener,
            entry.runtime.clone(),
            info.remote_host.clone(),
            info.remote_port,
            cancel_rx,
            Arc::new(Semaphore::new(MAX_CONNECTIONS_PER_FORWARD)),
            Arc::clone(&self.global_connections),
        ));
        {
            let mut state = self.state.lock();
            state.revision += 1;
            state.entries.insert(
                forward_id,
                Arc::new(ForwardEntry {
                    info,
                    cancel_tx,
                    task: Mutex::new(Some(task)),
                }),
            );
        }
        self.broadcast(session_id);
        Ok(returned)
    }

    pub fn stop(&self, session_id: &str, forward_id: &str) -> Result<(), String> {
        let entry = self
            .state
            .lock()
            .entries
            .get(forward_id)
            .filter(|entry| entry.info.session_id == session_id)
            .map(Arc::clone)
            .ok_or_else(|| format!("端口转发不存在: {forward_id}"))?;
        self.stop_entry(&entry);
        self.broadcast(session_id);
        Ok(())
    }

    fn stop_entry(&self, entry: &Arc<ForwardEntry>) {
        let _ = entry.cancel_tx.send(true);
        if let Some(task) = entry.task.lock().take() {
            task.abort();
        }
        let session_id = entry.info.session_id.clone();
        let mut state = self.state.lock();
        state.revision += 1;
        state.entries.remove(&entry.info.id);
        drop(state);
        self.broadcast(&session_id);
    }

    /// 标记失败并移除(监听任务报错时回调);错误写会话输出流提示用户。
    pub(crate) fn fail(&self, forward_id: &str, session_id: &str, error: String) {
        if let Some(entry) = self.state.lock().entries.remove(forward_id) {
            let _ = entry.cancel_tx.send(true);
            if let Some(task) = entry.task.lock().take() {
                task.abort();
            }
            self.state.lock().revision += 1;
            if let (Some(app), Some(registry)) = (super::global_app(), super::global_ssh()) {
                super::io::emit_output(
                    &app,
                    &registry,
                    session_id,
                    format!("[SSH] 端口转发已停止: {error}\r\n").as_bytes(),
                );
            }
            self.broadcast(session_id);
        }
    }

    /// 转发快照事件(ssh://event/{id} 的 forwards 变体)。
    fn broadcast(&self, session_id: &str) {
        let Some(app) = super::global_app() else {
            return;
        };
        let forwards = self.list(session_id);
        let _ = app.emit(
            &format!("ssh://event/{session_id}"),
            super::SshSessionEvent::Forwards { forwards },
        );
    }
}

/// 占用预检( advisory):start 的 bind 才是权威。
pub async fn local_port_available(port: u16) -> bool {
    TcpListener::bind((Ipv4Addr::LOCALHOST, port)).await.is_ok()
}

async fn pick_free_port() -> Result<u16, String> {
    for _ in 0..64 {
        let port = (crate::pty::random_u64() % 16_000) + u64::from(AUTO_PORT_START);
        let Ok(port) = u16::try_from(port) else {
            continue;
        };
        if local_port_available(port).await {
            return Ok(port);
        }
    }
    Err("自动分配本地端口失败(动态端口段耗尽)".to_string())
}

pub(crate) fn normalize_remote_host(host: &str) -> Result<String, String> {
    let host = host.trim();
    let host = if host.is_empty() { "127.0.0.1" } else { host };
    if host.len() > MAX_HOST_BYTES {
        return Err(format!("远端主机名超过 {MAX_HOST_BYTES} 字节"));
    }
    if host.chars().any(char::is_control) {
        return Err("远端主机名含控制字符".to_string());
    }
    Ok(host.to_string())
}

pub(crate) fn normalize_remote_port(port: u16) -> Result<u16, String> {
    if port == 0 {
        return Err("远端端口必须在 1-65535".to_string());
    }
    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_host_normalization() {
        assert_eq!(normalize_remote_host("  ").unwrap(), "127.0.0.1");
        assert_eq!(
            normalize_remote_host(" db.internal ").unwrap(),
            "db.internal"
        );
        assert!(normalize_remote_host(&"x".repeat(256)).is_err());
        assert!(normalize_remote_host("bad\nhost").is_err());
    }

    #[test]
    fn remote_port_normalization() {
        assert_eq!(normalize_remote_port(5432).unwrap(), 5432);
        assert!(normalize_remote_port(0).is_err());
    }
}
