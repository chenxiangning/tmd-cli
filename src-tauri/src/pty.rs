//! PTY 会话管理器 —— tmd-cli 的核心一等公民。
//!
//! 每个会话 = 一个 portable-pty 伪终端 + 一个 CLI 子进程。
//! 输出通过 Tauri event `pty://out/{id}` 推给前端 xterm.js 透传渲染。
//!
//! 拆分边界(文件规模铁则):
//! - 会话日志落盘/翻页 → crate::session_log;
//! - PATH 富化/命令解析 → crate::resolve(probe/installer 共用);
//! - spawn 全流程与输出泵 → crate::pty_spawn。

use std::collections::HashMap;
use std::io::Write;
use std::sync::Arc;

use crate::session_log::{read_history_page, HistoryPage, LogMeta};
use parking_lot::Mutex;
use portable_pty::{MasterPty, PtySize};
use serde::{Deserialize, Serialize};

/// 一次 PTY 会话的句柄。reader 线程在后台把字节流转发为 Tauri 事件。
pub(crate) struct PtyHandle {
    /// 每会话独立锁:写入可无限阻塞(子进程停读时),绝不能持全局注册表锁等它。
    pub(crate) writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub(crate) master: Box<dyn MasterPty + Send>,
    pub(crate) child: Box<dyn portable_pty::Child + Send + Sync>,
    /// 最近一次生效的 (cols, rows):resize 幂等去重。尺寸未变的 resize 若照发
    /// SIGWINCH,全屏 TUI(omp/claude)会整屏重绘 —— 切会话重挂载时 TerminalView
    /// 必发一次 syncSize,重绘输出会被前端活动守望误判成一轮对话
    /// (呼吸灯绿→蓝 + 结束音),而用户并未发起任何对话。
    pub(crate) size: Mutex<(u16, u16)>,
}

#[derive(Default)]
pub struct PtyRegistry {
    pub(crate) sessions: Arc<Mutex<HashMap<String, PtyHandle>>>,
    /// 会话输出日志账本:泵线程写,翻页命令读。
    pub(crate) logs: Arc<Mutex<HashMap<String, LogMeta>>>,
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
    /// 会话后端类型:缺省 "cli";内置终端传 "shell"。
    #[serde(default)]
    pub kind: Option<String>,
    /// 会话展示标题:缺省 None;内置终端传 shell 名(tab 条/侧栏直读)。
    #[serde(default)]
    pub title: Option<String>,
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
    /// 创建会话(openpty/命令构建/输出泵装配在 crate::pty_spawn)。
    pub fn spawn(
        &self,
        app: &tauri::AppHandle,
        profile_id: &str,
        spec: SpawnSpec,
    ) -> Result<SpawnedSession, String> {
        crate::pty_spawn::spawn(self, app, profile_id, spec)
    }

    /// 写入会话 stdin。PTY master 写入在子进程停止读入时会无限阻塞
    /// (挂起前台进程后粘贴即触发):①注册表锁只取句柄当场释放,锁内零 IO;
    /// ②每会话独立 writer 锁串行化写,单会话卡写不放大为全局卡死;
    /// ③命令层以 spawn_blocking 执行,不占 Tauri 主线程。
    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        let writer = {
            let sessions = self.sessions.lock();
            let handle = sessions
                .get(id)
                .ok_or_else(|| format!("会话 {id} 不存在"))?;
            Arc::clone(&handle.writer)
        };
        let mut w = writer.lock();
        w.write_all(data.as_bytes())
            .and_then(|_| w.flush())
            .map_err(|e| format!("写入 PTY 失败: {e}"))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock();
        let handle = sessions
            .get(id)
            .ok_or_else(|| format!("会话 {id} 不存在"))?;
        /* 尺寸未变 = 幂等跳过:不发 SIGWINCH,TUI 不重绘,前端呼吸灯语义不受扰 */
        let mut size = handle.size.lock();
        if *size == (cols, rows) {
            return Ok(());
        }
        handle
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("resize 失败: {e}"))?;
        *size = (cols, rows);
        Ok(())
    }

    pub fn kill(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        let mut handle = sessions
            .remove(id)
            .ok_or_else(|| format!("会话 {id} 不存在"))?;
        handle.child.kill().map_err(|e| format!("kill 失败: {e}"))
    }

    /// 应用退出时清场:逐个 kill 全部存活子进程。缺它则 PTY 子进程成孤儿
    /// 常驻(自动激活每次启动新增一代 resume 进程,泄漏随启动次数累积)。
    pub fn kill_all(&self) {
        let mut sessions = self.sessions.lock();
        for (_, mut handle) in sessions.drain() {
            let _ = handle.child.kill();
        }
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
pub(crate) fn uuid_v4() -> String {
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
pub(crate) fn random_u64() -> u64 {
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
mod tests {
    use super::*;
    use portable_pty::{native_pty_system, CommandBuilder};

    /// resize 幂等契约:记录尺寸随真实变更更新,同尺寸调用保持记录不变。
    /// 记录错误 = 后续同尺寸 resize 漏去重 → SIGWINCH 重绘 → 前端误判对话轮次。
    #[test]
    fn resize_尺寸记录随真实变更更新() {
        let registry = PtyRegistry::default();
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");
        /* 常驻子进程读端:unix 用 cat,windows 用 cmd.exe(等输入不退出) */
        #[cfg(windows)]
        let child = pair
            .slave
            .spawn_command(CommandBuilder::new("cmd.exe"))
            .expect("spawn cmd.exe");
        #[cfg(not(windows))]
        let child = pair
            .slave
            .spawn_command(CommandBuilder::new("cat"))
            .expect("spawn cat");
        let writer = pair.master.take_writer().expect("writer");
        registry.sessions.lock().insert(
            "t".to_string(),
            PtyHandle {
                writer: Arc::new(Mutex::new(writer)),
                master: pair.master,
                child,
                size: Mutex::new((80, 24)),
            },
        );
        /* 同尺寸:幂等跳过,记录不变 */
        registry.resize("t", 80, 24).expect("same-size resize");
        /* 真实变更:生效并记录 */
        registry.resize("t", 100, 40).expect("real resize");
        let sessions = registry.sessions.lock();
        assert_eq!(*sessions["t"].size.lock(), (100, 40));
    }
}
