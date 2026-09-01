//! PTY 会话管理器 —— tmd-cli 的核心一等公民。
//!
//! 每个会话 = 一个 portable-pty 伪终端 + 一个 CLI 子进程。
//! 输出通过 Tauri event `pty://out/{id}` 推给前端 xterm.js 透传渲染。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// 一次 PTY 会话的句柄。reader 线程在后台把字节流转发为 Tauri 事件。
struct PtyHandle {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyRegistry {
    sessions: Arc<Mutex<HashMap<String, PtyHandle>>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnSpec {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: String,
    #[serde(default = "default_cols")]
    pub cols: u16,
    #[serde(default = "default_rows")]
    pub rows: u16,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

fn default_cols() -> u16 {
    120
}
fn default_rows() -> u16 {
    32
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnedSession {
    pub id: String,
    pub pid: Option<u32>,
}

impl PtyRegistry {
    pub fn spawn(&self, app: &AppHandle, spec: SpawnSpec) -> Result<SpawnedSession, String> {
        let id = uuid_v4();
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: spec.rows,
                cols: spec.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty 失败: {e}"))?;

        let mut cmd = CommandBuilder::new(&spec.command);
        cmd.args(&spec.args);
        cmd.cwd(&spec.cwd);
        // 全屏 TUI 依赖 TERM;Finder/Dock 启动的 .app(launchd 环境)与 Windows ConPTY 默认无 TERM,
        // 缺失时 omp/pi/codex 退化为 dumb terminal 渲染。先给默认值,spec.env 可覆盖。
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        for (k, v) in &spec.env {
            cmd.env(k, v);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn `{}` 失败: {e}", spec.command))?;
        let pid = child.process_id();

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("clone reader 失败: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("take writer 失败: {e}"))?;

        // 输出泵：PTY → Tauri event。xterm.js 只认这条通道。
        let out_id = id.clone();
        let out_app = app.clone();
        std::thread::spawn(move || {
            let event = format!("pty://out/{out_id}");
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        if out_app.emit(&event, text).is_err() {
                            break; // 前端已销毁
                        }
                    }
                    Err(_) => break,
                }
            }
            let _ = out_app.emit(&format!("pty://exit/{out_id}"), ());
        });

        self.sessions.lock().insert(
            id.clone(),
            PtyHandle {
                writer,
                master: pair.master,
                child,
            },
        );

        Ok(SpawnedSession { id, pid })
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        let handle = sessions.get_mut(id).ok_or_else(|| format!("会话 {id} 不存在"))?;
        handle
            .writer
            .write_all(data.as_bytes())
            .and_then(|_| handle.writer.flush())
            .map_err(|e| format!("写入 PTY 失败: {e}"))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock();
        let handle = sessions.get(id).ok_or_else(|| format!("会话 {id} 不存在"))?;
        handle
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("resize 失败: {e}"))
    }

    pub fn kill(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        let mut handle = sessions.remove(id).ok_or_else(|| format!("会话 {id} 不存在"))?;
        handle.child.kill().map_err(|e| format!("kill 失败: {e}"))
    }
}

/// 无 uuid 依赖的 id 生成：时间戳 + 计数器 + 随机段。
/// 随机段必须存在：纳秒时间戳的 hex 高 6 位约 3 天才变一次,
/// 前端列表取 id 前/后 6 位展示,纯时间戳会显示碰撞(一堆"一样的 id")。
fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!(
        "{:x}-{:x}-{:016x}",
        nanos,
        COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
        random_u64()
    )
}

/// 零依赖随机源：读 /dev/urandom(macOS/Linux);失败退回 pid ^ 纳秒兜底。
fn random_u64() -> u64 {
    use std::io::Read;
    let mut buf = [0u8; 8];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        if f.read_exact(&mut buf).is_ok() {
            return u64::from_le_bytes(buf);
        }
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    nanos ^ ((std::process::id() as u64) << 32)
}
