//! 裸命令名 → 可执行绝对路径解析(pty spawn / probe 共用)。
//! Windows 命中 .cmd/.bat npm shim 时经 `cmd /c` 包裹。

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
}
