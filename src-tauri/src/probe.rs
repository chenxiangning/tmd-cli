//! CLI 探针 —— 检测用户本机是否安装某个 CLI(omp/pi/codex/claude/...),
//! 返回 found/path/version。
//!
//! 设计决策(对齐 codemoss cli_installer.run_binary_version,但更薄):
//! - 单一入口 `probe_cli` → `CliProbeResult`,供 Tauri command 包装。
//! - 超时硬限 8s,避免 PATH 中挂死的 binary 卡住首屏。
//! - PATH 与 pty/installer 同源(enriched_path),进程内缓存一次:probe 是
//!   只读探针;用户改了 PATH 重启应用即可。
//! - 不查 latest_version / update_available:UI 只需"装了/没装 + 当前版本",
//!   是否要升级是后续版本的事。
//!
//! 阻塞安全:`cli_probe` Tauri command 必须 async + spawn_blocking
//! (见 lib.rs),本模块全部是同步阻塞代码,禁止直接在主线程执行。

use serde::{Deserialize, Serialize};
use std::process::Command;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use crate::resolve::{enriched_path, wait_child_with_timeout};

/// 探针超时硬限(秒)。与 codemoss PREFLIGHT_TIMEOUT_SECS=8 对齐。
const PROBE_TIMEOUT_SECS: u64 = 8;

/// 探针 PATH 进程级缓存:enriched_path = login shell > 进程 PATH > 常见安装
/// 目录兜底。曾直接用裸 login_shell_path():rc 慢的机器(代理检测/端口扫描类
/// zshrc 秒级起步)撞 3s 硬超时返回 None,而 LazyLock 把 None 永久缓存 →
/// 所有引擎误报"未安装"且刷新键无法自愈。富化 PATH 的兜底层保证超时只损失
/// login shell 独有目录,不再致盲。
static PROBE_PATH: LazyLock<&'static str> = LazyLock::new(enriched_path);

/// 探针结果。`found=false` 时 path/version 都是 None,前端按"未安装"渲染。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProbeResult {
    /// 原始命令名(omp / pi / codex / claude ...)。
    pub command: String,
    /// PATH 解析是否成功。
    pub found: bool,
    /// 解析出的可执行绝对路径(`found=true` 时非空)。
    pub path: Option<String>,
    /// `--version` 输出的第一行 trimmed(`found=true` 时非空)。
    pub version: Option<String>,
}

/// 探针入口。`command` 是裸 binary 名,允许包含 `/` 或 `\`(绝对路径)。
///
/// 路径查找逻辑(与 pty.rs resolve_command 不同 —— 那个给 PTY spawn 用,
/// 找不到时返回原命令名让 PTY 自己报错;本函数只做"探针",找不到 = found=false)。
pub fn probe_cli(command: &str) -> CliProbeResult {
    let command = command.trim();
    if command.is_empty() {
        return empty_result("");
    }

    let Some(absolute) = find_binary_absolute(command) else {
        return empty_result(command);
    };

    let version = run_version(&absolute);

    CliProbeResult {
        command: command.to_string(),
        found: true,
        path: Some(absolute),
        version,
    }
}

/// 在 PATH 中找 binary,或在绝对路径上直接判存在/可执行。
/// 返回绝对路径;找不到 = None。
fn find_binary_absolute(command: &str) -> Option<String> {
    /* 绝对路径:直接判存在 + 可执行(不走 PATH)。 */
    if command.contains('/') || command.contains('\\') {
        let p = std::path::Path::new(command);
        if !is_executable_file(p) {
            return None;
        }
        return Some(command.to_string());
    }

    /* 裸名:在富化 PATH(login shell > 进程 > 兜底目录)中找(进程内缓存)。 */
    let path = *PROBE_PATH;
    for dir in std::env::split_paths(std::ffi::OsStr::new(&path)) {
        let candidate = dir.join(command);
        if is_executable_file(&candidate) {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
}

/// 跨平台可执行判定:unix 看 mode & 0o111,Windows 仅判 is_file。
fn is_executable_file(p: &std::path::Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        p.metadata()
            .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        p.is_file()
    }
}

/// `--version` 输出第一行 trimmed。失败/超时 = None,不抛错(前端按"未安装"渲染)。
fn run_version(program: &str) -> Option<String> {
    let mut cmd = Command::new(program);
    cmd.arg("--version");
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let started = Instant::now();
    let mut child = cmd.spawn().ok()?;
    let exit = wait_child_with_timeout(&mut child, Duration::from_secs(PROBE_TIMEOUT_SECS));

    let output = match exit {
        Some(Ok(status)) if status.success() => child.wait_with_output().ok(),
        _ => return None, /* 超时已被 wait_child_with_timeout kill;失败进程已退出。 */
    };
    let _ = started; /* 留作未来 metrics(单次探针耗时)。 */
    let output = output?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let first_line = stdout.lines().next().unwrap_or("").trim();
    if first_line.is_empty() {
        None
    } else {
        Some(first_line.to_string())
    }
}

fn empty_result(command: &str) -> CliProbeResult {
    CliProbeResult {
        command: command.to_string(),
        found: false,
        path: None,
        version: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_command_returns_not_found() {
        let r = probe_cli("");
        assert!(!r.found);
        assert!(r.path.is_none());
    }

    #[test]
    fn nonexistent_command_returns_not_found() {
        let r = probe_cli("definitely-not-a-real-cli-xyz-12345");
        assert!(!r.found);
        assert!(r.path.is_none());
    }

    #[test]
    fn result_shape_is_camel_case() {
        /* 序列化键名稳定是前后端契约。 */
        let r = CliProbeResult {
            command: "x".into(),
            found: false,
            path: None,
            version: None,
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("\"found\":false"));
        assert!(json.contains("\"command\":\"x\""));
        assert!(json.contains("\"path\":null"));
    }

    #[cfg(unix)]
    #[test]
    fn probe_finds_system_binary_via_enriched_path() {
        /* 回归守卫:PATH 查找链(find_binary_absolute × enriched_path)必须
         * 命中 /bin 兜底目录里的 sh —— 守住"PATH 内二进制不漏检"契约。 */
        let r = probe_cli("sh");
        assert!(r.found, "sh 未命中:PATH 查找链断裂");
        assert!(r.version.is_some());
    }
}
