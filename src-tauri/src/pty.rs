//! PTY 会话管理器 —— tmd-cli 的核心一等公民。
//!
//! 每个会话 = 一个 portable-pty 伪终端 + 一个 CLI 子进程。
//! 输出通过 Tauri event `pty://out/{id}` 推给前端 xterm.js 透传渲染。
//!
//! 拆分边界(文件规模铁则):
//! - 会话日志落盘/翻页 → crate::session_log;
//! - PATH 富化/命令解析 → crate::resolve(probe/installer 共用)。

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::sync::Arc;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use crate::resolve::{enriched_path, resolve_command};
use crate::session_log::{
    append_log, read_history_page, session_log_path, HistoryPage, LogMeta,
};

/// 增量 UTF-8 解码：不完整的多字节尾部暂存进 `tail`，与下一 chunk 拼接后再解码。
/// 真正的坏字节(error_len 存在)按 U+FFFD 替换；仅是"没读完"的字节绝不误伤。
fn decode_utf8_chunk(tail: &mut Vec<u8>, chunk: &[u8]) -> String {
    let mut bytes = std::mem::take(tail);
    bytes.extend_from_slice(chunk);

    let mut start = 0;
    let mut text = String::with_capacity(bytes.len());
    loop {
        match std::str::from_utf8(&bytes[start..]) {
            Ok(valid) => {
                text.push_str(valid);
                start = bytes.len();
                break;
            }
            Err(e) => {
                let up_to = start + e.valid_up_to();
                // 安全:valid_up_to 边界内必为合法 UTF-8
                text.push_str(unsafe { std::str::from_utf8_unchecked(&bytes[start..up_to]) });
                match e.error_len() {
                    Some(len) => {
                        text.push('\u{FFFD}');
                        start = up_to + len;
                    }
                    None => {
                        start = up_to;
                        break;
                    }
                }
            }
        }
    }
    tail.extend_from_slice(&bytes[start..]);
    text
}

/// 输出聚合窗:首个 chunk 到达后再收 8ms 内的后续 chunk,拼成一个事件发出。
/// 8KB/次的 read 在高吞吐场景(编译刷屏、cat 大文件)会打成事件风暴,
/// Tauri IPC 序列化 + WebView 派发是主线程开销大头;8ms ≈ 半个 60fps 帧,
/// 人眼无感,事件数可降一个数量级。
const OUT_AGGREGATE_WINDOW: Duration = Duration::from_millis(8);
/// 单次聚合批次的字节上限:防恶意/失控输出在窗口内无限堆积撑爆内存。
const OUT_AGGREGATE_MAX_BYTES: usize = 1024 * 1024;

/// 一次 PTY 会话的句柄。reader 线程在后台把字节流转发为 Tauri 事件。
struct PtyHandle {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyRegistry {
    sessions: Arc<Mutex<HashMap<String, PtyHandle>>>,
    /// 会话输出日志账本:泵线程写,翻页命令读。
    logs: Arc<Mutex<HashMap<String, LogMeta>>>,
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
    pub fn spawn(
        &self,
        app: &AppHandle,
        profile_id: &str,
        spec: SpawnSpec,
    ) -> Result<SpawnedSession, String> {
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

        /* 注入完整 PATH:命令解析与 CLI 孙进程(git/node 等)都依赖它 */
        let path = enriched_path();
        let resolved = resolve_command(&spec.command, path);
        let mut cmd = CommandBuilder::new(&resolved.program);
        /* Windows 批处理 shim 的 cmd /c 前插参数,unix 为空 */
        cmd.args(&resolved.prefix_args);
        cmd.args(&spec.args);
        cmd.cwd(&spec.cwd);
        cmd.env("PATH", path);
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

        /* 会话输出日志:~/.tmd-cli/session/<引擎>/<项目-slug>/<id>.log。
           创建失败不阻塞终端,仅关闭"加载更早输出"能力 */
        let log_path = session_log_path(profile_id, &spec.cwd, &id);
        let log_file = log_path
            .parent()
            .and_then(|dir| std::fs::create_dir_all(dir).ok())
            .and_then(|_| {
                OpenOptions::new()
                    .create(true)
                    .write(true)
                    .truncate(true)
                    .open(&log_path)
                    .ok()
            });
        let log_path = log_file.as_ref().map(|_| log_path);
        if let Some(path) = log_path.as_ref() {
            self.logs.lock().insert(
                id.clone(),
                LogMeta {
                    written: 0,
                    base: 0,
                    path: path.clone(),
                },
            );
        }

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("clone reader 失败: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("take writer 失败: {e}"))?;

        /* 输出泵：PTY → Tauri event + 会话日志。xterm.js 只认事件通道。
           聚合选型:portable-pty 的 reader 只有阻塞 read(无 try_read),
           最小侵入方案是拆 channel 两段 ——
           reader 线程只管阻塞读 + send 原始字节(职责单一,永不阻塞下游);
           emitter 线程 recv 首 chunk 后在 8ms 窗口内 drain 尽所有后续 chunk,
           拼成一批再落日志/解码/emit。日志按批次追加(字节序不变,
           read_history_page 的偏移语义不受影响)。 */
        let out_id = id.clone();
        let out_app = app.clone();
        let logs = Arc::clone(&self.logs);
        let (out_tx, out_rx) = mpsc::channel::<Vec<u8>>();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    /* 下游已退出(前端销毁/会话结束)即停 */
                    Ok(n) => {
                        if out_tx.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            /* drop(out_tx) 随线程结束自动发生 → emitter 收 Disconnected 退出 */
        });
        std::thread::spawn(move || {
            let event = format!("pty://out/{out_id}");
            /* 跨 chunk 的不完整 UTF-8 尾部(如 3 字节中文被聚合批边界劈开),
               暂存后与下一批拼接再解码,避免 from_utf8_lossy 逐包转换产生 */
            let mut tail: Vec<u8> = Vec::new();
            let mut log_file = log_file;
            loop {
                /* 阻塞等首 chunk;channel 关闭且排空 → 会话结束 */
                let mut batch = match out_rx.recv() {
                    Ok(first) => first,
                    Err(_) => break,
                };
                /* 聚合窗:drain 窗口内已到达的所有 chunk,合并为一个事件 */
                let deadline = Instant::now() + OUT_AGGREGATE_WINDOW;
                while batch.len() < OUT_AGGREGATE_MAX_BYTES {
                    let now = Instant::now();
                    if now >= deadline {
                        break;
                    }
                    match out_rx.recv_timeout(deadline - now) {
                        Ok(chunk) => batch.extend_from_slice(&chunk),
                        /* Timeout → 窗口耗尽;Disconnected → 先发完手头这批,
                           下一轮 recv 拿到 Err 再统一走退出清理 */
                        Err(_) => break,
                    }
                }
                /* 原始字节先落日志(供幕布往前翻页),再解码推事件 */
                if let (Some(file), Some(path)) = (log_file.as_mut(), log_path.as_ref()) {
                    if append_log(&logs, &out_id, file, path, &batch).is_err() {
                        log_file = None; // 日志失败不拖累终端;翻页能力降级
                    }
                }
                let text = decode_utf8_chunk(&mut tail, &batch);
                if out_app.emit(&event, text).is_err() {
                    break; // 前端已销毁
                }
            }
            /* 进程退出即会话销毁:清理日志文件与账本(kill 路径同样经由此处) */
            if let Some(path) = log_path.as_ref() {
                let _ = std::fs::remove_file(path);
            }
            logs.lock().remove(&out_id);
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

    /// 会话全量输出的绝对末尾偏移(= 累计写入字节数);无日志返回 None。
    pub fn session_log_end(&self, id: &str) -> Option<u64> {
        self.logs.lock().get(id).map(|m| m.written)
    }

    /// 往前翻一页:before 绝对偏移之前最多 max_bytes 字节的原始输出。
    pub fn session_history_page(
        &self,
        id: &str,
        before: u64,
        max_bytes: u64,
    ) -> Result<HistoryPage, String> {
        let meta = self
            .logs
            .lock()
            .get(id)
            .cloned()
            .ok_or_else(|| format!("会话 {id} 无输出日志"))?;
        read_history_page(&meta.path, meta.base, meta.written, before, max_bytes)
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

#[cfg(test)]
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_utf8_chunk_多字节字符跨包不产生替换符() {
        /* "输出中" 共 9 字节;切在 7 = "中" 的 3 字节被劈成 1 + 2,模拟 8KB chunk 边界 */
        let bytes = "输出中".as_bytes();
        let cut = 7;
        let mut tail = Vec::new();
        let first = decode_utf8_chunk(&mut tail, &bytes[..cut]);
        let second = decode_utf8_chunk(&mut tail, &bytes[cut..]);
        assert_eq!(format!("{first}{second}"), "输出中");
        assert!(!first.contains('\u{FFFD}'));
        assert!(tail.is_empty());
    }

    #[test]
    fn decode_utf8_chunk_真正的坏字节才替换() {
        let mut tail = Vec::new();
        let text = decode_utf8_chunk(&mut tail, &[0xff, b'a']);
        assert_eq!(text, "\u{FFFD}a");
    }
}
