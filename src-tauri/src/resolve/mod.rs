//! 打包环境命令解析 —— PATH 富化与裸命令名 → 绝对路径。
//!
//! 消费方:pty.rs(PTY spawn)、probe.rs(CLI 探针)、installer.rs(一键安装)、
//! lib.rs(进程级 PATH 修复)。PATH 进程级缓存;降级结果(login shell
//! 超时/失败)不永久缓存 —— 后台重试 + probe 同步重算,可自愈。
//!
//! 拆分(2026-09-02 文件规模铁则):
//! - `path_cache`:PATH 富化/两级 login shell 提取/降级自愈缓存
//! - `which`:裸命令名 → 绝对路径(Windows 批处理 shim 包裹)
//! - 本文件:模块出口 + 共享的带超时子进程等待原语

mod path_cache;
mod which;

pub(crate) use path_cache::{enriched_path, enriched_path_refresh};
pub(crate) use which::{find_in_dir, resolve_command};

/// GUI 进程在 Windows 上 spawn 控制台子进程(probe --version / npm 安装 /
/// git 网络操作)时,系统会为子进程新建一个可见的控制台窗口并闪现。
/// CREATE_NO_WINDOW 抑制之;PTY 通路走 ConPTY,不经过此函数。
/// 非 Windows 为空操作,调用方无需 cfg 门控。
pub(crate) fn hide_console(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        /* 0x0800_0000 = CREATE_NO_WINDOW */
        cmd.creation_flags(0x0800_0000);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

/* ---------- 打包环境命令解析 ----------
 * macOS: Finder/Dock 启动的 .app 由 launchd 拉起,PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin,
 *   claude/omp/pi/codex 装在 ~/.local/bin、/opt/homebrew/bin → 裸命令名 spawn 必失败。
 *   解法:login shell 两级提取(-lc 快路径优先,-ilc 兜底/升级)+ 合并兜底目录,
 *   进程级缓存(降级可自愈),命令解析为绝对路径。
 * Linux: 桌面环境启动同样 PATH 贫瘠,同一机制覆盖;$SHELL 为 dash 等不支持 -l 时
 *   静默降级到进程 PATH + 兜底目录。
 * Windows: GUI 应用继承注册表合并 PATH,通常不缺目录;真正的坑是 npm 全局 CLI 是
 *   .cmd/.bat shim,CreateProcess 不解析无扩展名批处理 → 按 PATHEXT 搜索,
 *   命中批处理时包裹 `cmd /c`。 */

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
