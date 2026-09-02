//! 打包环境命令解析 —— PATH 富化与裸命令名 → 绝对路径。
//!
//! 消费方:pty.rs(PTY spawn)、probe.rs(CLI 探针)、installer.rs(一键安装)、
//! lib.rs(进程级 PATH 修复)。全部缓存一次(LazyLock),多线程只算一次。

use std::sync::LazyLock;

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
        push_unique_dir(
            &mut dirs,
            std::path::Path::new(&home).join(".local").join("bin"),
        );
        /* xai 官方 install.sh 固定装 ~/.grok/bin —— login shell 超时丢目录时兜底 */
        push_unique_dir(
            &mut dirs,
            std::path::Path::new(&home).join(".grok").join("bin"),
        );
    }
    #[cfg(target_os = "macos")]
    push_unique_dirs(
        &mut dirs,
        std::ffi::OsStr::new("/opt/homebrew/bin:/usr/local/bin"),
    );
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

/// 子进程等待超时(秒)。login shell 加载用户 rc 文件,oh-my-zsh 类重配置
/// 秒级起步;rc 里有交互/阻塞读取则永久挂住 —— 必须硬超时。
const SHELL_PATH_TIMEOUT_SECS: u64 = 3;

/// 带超时的子进程等待。超时 kill 并返回 None;调用方无需再 kill。
/// sleep+try_wait 轮询(100ms tick),不引入 wait-timeout crate。
pub(crate) fn wait_child_with_timeout(
    child: &mut std::process::Child,
    timeout: std::time::Duration,
) -> Option<std::io::Result<std::process::ExitStatus>> {
    let started = std::time::Instant::now();
    let tick = std::time::Duration::from_millis(100);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(Ok(status)),
            Ok(None) => {
                if started.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait(); /* 防 zombie */
                    return None;
                }
                std::thread::sleep(tick);
            }
            Err(e) => return Some(Err(e)),
        }
    }
}

/// 从用户 login shell 提取 PATH。哨兵包裹输出,免疫用户 rc 文件的噪音打印。
/// 3s 硬超时:rc 挂住时返回 None,调用方用兜底 PATH,不卡主流程。
/// 仅 unix:Windows 无 login shell 概念,GUI 进程已继承注册表合并 PATH。
#[cfg(unix)]
pub(crate) fn login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    const BEGIN: &str = "__TMD_PATH_BEGIN__";
    const END: &str = "__TMD_PATH_END__";
    let mut child = std::process::Command::new(shell)
        .args([
            "-ilc",
            &format!("echo {BEGIN}; printf '%s' \"$PATH\"; echo; echo {END}"),
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .ok()?;

    /* rc 文件 fork 的守护进程(ssh-agent 等)会继承管道写端:wait 之后再
     * read-to-EOF 永不返回。必须在 spawn 后立刻并发排空两个管道,
     * 退出后用带超时的 channel 收 stdout,超时即放弃(防挂死)。 */
    use std::io::Read;
    let mut stdout_pipe = child.stdout.take()?;
    let mut stderr_pipe = child.stderr.take()?;
    let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout_pipe.read_to_end(&mut buf);
        let _ = tx.send(buf);
        /* buf 随线程消亡;stderr 同法排空(内容不关心,只为防子进程写阻塞) */
    });
    std::thread::spawn(move || {
        let mut sink = Vec::new();
        let _ = stderr_pipe.read_to_end(&mut sink);
    });

    let exit = wait_child_with_timeout(
        &mut child,
        std::time::Duration::from_secs(SHELL_PATH_TIMEOUT_SECS),
    )?;
    if !exit.ok()?.success() {
        return None;
    }
    let out = rx.recv_timeout(std::time::Duration::from_secs(1)).ok()?;
    let text = String::from_utf8_lossy(&out);
    let path = text
        .split_once(BEGIN)?
        .1
        .split_once(END)?
        .0
        .trim()
        .to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

#[cfg(windows)]
pub(crate) fn login_shell_path() -> Option<String> {
    None
}

/// 解析结果:最终 program + 需要前插的参数(Windows 批处理 shim → ["cmd.exe", "/c", path])。
pub(crate) struct ResolvedCommand {
    pub program: String,
    pub prefix_args: Vec<String>,
}

/// 裸命令名 → 可执行绝对路径;找不到时原样返回,错误信息仍指向原命令名。
/// Windows 下命中 .cmd/.bat shim 时改为 cmd /c 包裹(CreateProcess 不能直跑批处理)。
pub(crate) fn resolve_command(command: &str, path: &str) -> ResolvedCommand {
    let has_separator = command.contains('/') || command.contains('\\');
    if has_separator {
        return wrap_if_batch(command.to_string());
    }
    for dir in std::env::split_paths(std::ffi::OsStr::new(path)) {
        if let Some(candidate) = find_in_dir(&dir, command) {
            return wrap_if_batch(candidate.to_string_lossy().into_owned());
        }
    }
    ResolvedCommand {
        program: command.to_string(),
        prefix_args: Vec::new(),
    }
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
    let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
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
        return ResolvedCommand {
            program: comspec,
            prefix_args: vec!["/c".to_string(), path],
        };
    }
    ResolvedCommand {
        program: path,
        prefix_args: Vec::new(),
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_command_在_path_中找到可执行文件并返回绝对路径() {
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
    fn enriched_path_包含进程_path_与常见安装目录且去重() {
        let path = enriched_path();
        for dir in ["/usr/bin", "/bin"] {
            assert!(path.split(':').any(|d| d == dir), "缺 {dir}: {path}");
        }
        let dirs: Vec<&str> = path.split(':').collect();
        let unique: std::collections::HashSet<_> = dirs.iter().collect();
        assert_eq!(dirs.len(), unique.len(), "PATH 有重复项: {path}");
    }
}
