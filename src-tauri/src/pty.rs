//! PTY 会话管理器 —— tmd-cli 的核心一等公民。
//!
//! 每个会话 = 一个 portable-pty 伪终端 + 一个 CLI 子进程。
//! 输出通过 Tauri event `pty://out/{id}` 推给前端 xterm.js 透传渲染。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use std::sync::LazyLock;

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
/* ---------- 打包环境命令解析 ----------
 * macOS: Finder/Dock 启动的 .app 由 launchd 拉起,PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin,
 *   claude/omp/pi/codex 装在 ~/.local/bin、/opt/homebrew/bin → 裸命令名 spawn 必失败。
 *   解法:login shell 提取真实 PATH + 合并兜底目录,缓存一次,命令解析为绝对路径。
 * Linux: 桌面环境启动同样 PATH 贫瘠,同一机制覆盖;$SHELL 为 dash 等不支持 -l 时
 *   静默降级到进程 PATH + 兜底目录。
 * Windows: GUI 应用继承注册表合并 PATH,通常不缺目录;真正的坑是 npm 全局 CLI 是
 *   .cmd/.bat shim,CreateProcess 不解析无扩展名批处理 → 按 PATHEXT 搜索,
 *   命中批处理时包裹 `cmd /c`。 */

static ENRICHED_PATH: LazyLock<String> = LazyLock::new(build_enriched_path);

/// 合并后的 PATH:login shell(unix) > 进程环境 > 常见安装目录(去重,保序)。
pub(crate) fn enriched_path() -> &'static str {
    &ENRICHED_PATH
}

fn push_unique_dirs(dirs: &mut Vec<std::path::PathBuf>, value: &std::ffi::OsStr) {
    for dir in std::env::split_paths(value) {
        if !dir.as_os_str().is_empty() && !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
}

fn push_unique_dir(dirs: &mut Vec<std::path::PathBuf>, dir: std::path::PathBuf) {
    if !dirs.contains(&dir) {
        dirs.push(dir);
    }
}

fn build_enriched_path() -> String {
    let mut dirs: Vec<std::path::PathBuf> = Vec::new();
    if let Some(login) = login_shell_path() {
        push_unique_dirs(&mut dirs, std::ffi::OsStr::new(&login));
    }
    if let Some(current) = std::env::var_os("PATH") {
        push_unique_dirs(&mut dirs, &current);
    }
    /* 家目录 bin:unix 用 HOME,Windows 用 USERPROFILE */
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    if let Some(home) = home {
        push_unique_dir(&mut dirs, std::path::Path::new(&home).join(".local").join("bin"));
    }
    #[cfg(target_os = "macos")]
    push_unique_dirs(&mut dirs, std::ffi::OsStr::new("/opt/homebrew/bin:/usr/local/bin"));
    #[cfg(target_os = "linux")]
    push_unique_dirs(&mut dirs, std::ffi::OsStr::new("/usr/local/bin:/snap/bin"));
    #[cfg(windows)]
    {
        /* npm 全局目录通常在注册表 PATH 里,补一道兜底 */
        if let Some(appdata) = std::env::var_os("APPDATA") {
            push_unique_dir(&mut dirs, std::path::Path::new(&appdata).join("npm"));
        }
    }
    std::env::join_paths(dirs)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// 从用户 login shell 提取 PATH。哨兵包裹输出,免疫用户 rc 文件的噪音打印。
/// 仅 unix:Windows 无 login shell 概念,GUI 进程已继承注册表合并 PATH。
#[cfg(unix)]
fn login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    const BEGIN: &str = "__TMD_PATH_BEGIN__";
    const END: &str = "__TMD_PATH_END__";
    let out = std::process::Command::new(shell)
        .args(["-ilc", &format!("echo {BEGIN}; printf '%s' \"$PATH\"; echo; echo {END}")])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let path = text
        .split_once(BEGIN)?
        .1
        .split_once(END)?
        .0
        .trim()
        .to_string();
    if path.is_empty() { None } else { Some(path) }
}

#[cfg(windows)]
fn login_shell_path() -> Option<String> {
    None
}

/// 解析结果:最终 program + 需要前插的参数(Windows 批处理 shim → ["cmd.exe", "/c", path])。
pub(crate) struct ResolvedCommand {
    pub program: String,
    pub prefix_args: Vec<String>,
}

/// 裸命令名 → 可执行绝对路径;找不到时原样返回,错误信息仍指向原命令名。
/// Windows 下命中 .cmd/.bat shim 时改为 cmd /c 包裹(CreateProcess 不能直跑批处理)。
fn resolve_command(command: &str, path: &str) -> ResolvedCommand {
    let has_separator = command.contains('/') || command.contains('\\');
    if has_separator {
        return wrap_if_batch(command.to_string());
    }
    for dir in std::env::split_paths(std::ffi::OsStr::new(path)) {
        if let Some(candidate) = find_in_dir(&dir, command) {
            return wrap_if_batch(candidate.to_string_lossy().into_owned());
        }
    }
    ResolvedCommand { program: command.to_string(), prefix_args: Vec::new() }
}

#[cfg(unix)]
fn find_in_dir(dir: &std::path::Path, command: &str) -> Option<std::path::PathBuf> {
    let candidate = dir.join(command);
    is_executable(&candidate).then_some(candidate)
}

#[cfg(windows)]
fn find_in_dir(dir: &std::path::Path, command: &str) -> Option<std::path::PathBuf> {
    /* 已带扩展名 → 直接命中;否则按 PATHEXT 顺序补扩展名 */
    if std::path::Path::new(command).extension().is_some() {
        let candidate = dir.join(command);
        return candidate.is_file().then_some(candidate);
    }
    let pathext = std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    for ext in pathext.split(';').filter(|e| !e.is_empty()) {
        let ext = ext.trim_start_matches('.');
        let candidate = dir.join(format!("{command}.{ext}"));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// 批处理 shim 必须经 cmd /c 执行;其余原样。非 Windows 永不包裹。
fn wrap_if_batch(path: String) -> ResolvedCommand {
    #[cfg(windows)]
    if is_batch_script(&path) {
        let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
        return ResolvedCommand { program: comspec, prefix_args: vec!["/c".to_string(), path] };
    }
    ResolvedCommand { program: path, prefix_args: Vec::new() }
}

/// 纯函数:路径是否指向 Windows 批处理脚本(大小写不敏感)。跨平台可测。
#[cfg(any(windows, test))]
fn is_batch_script(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".cmd") || lower.ends_with(".bat")
}

#[cfg(unix)]
fn is_executable(path: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &std::path::Path) -> bool {
    path.is_file()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_command_在_PATH_中找到可执行文件并返回绝对路径() {
        let r = resolve_command("ls", "/bin:/usr/bin");
        assert_eq!(r.program, "/bin/ls");
        assert!(r.prefix_args.is_empty());
    }

    #[test]
    fn resolve_command_找不到时原样返回() {
        let r = resolve_command("tmd-no-such-cmd", "/bin");
        assert_eq!(r.program, "tmd-no-such-cmd");
        assert!(r.prefix_args.is_empty());
    }

    #[test]
    fn resolve_command_已是路径时原样返回() {
        let r = resolve_command("/bin/ls", "/usr/bin");
        assert_eq!(r.program, "/bin/ls");
        assert!(r.prefix_args.is_empty());
    }

    #[test]
    fn is_batch_script_仅识别_cmd_bat_扩展名() {
        assert!(is_batch_script("C:\\Users\\x\\AppData\\npm\\claude.CMD"));
        assert!(is_batch_script("npm/omp.bat"));
        assert!(!is_batch_script("/opt/homebrew/bin/omp"));
        assert!(!is_batch_script("claude.exe"));
    }

    #[test]
    fn enriched_path_包含进程_PATH_与常见安装目录且去重() {
        let path = enriched_path();
        for dir in ["/usr/bin", "/bin"] {
            assert!(path.split(':').any(|d| d == dir), "缺 {dir}: {path}");
        }
        let dirs: Vec<&str> = path.split(':').collect();
        let unique: std::collections::HashSet<_> = dirs.iter().collect();
        assert_eq!(dirs.len(), unique.len(), "PATH 有重复项: {path}");
    }
}
