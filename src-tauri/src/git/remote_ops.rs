//! 远端操作 —— fetch / pull / push shell-out。
//!
//! 凭据链(ssh-agent / GCM / netrc)由 git CLI 自带,不值得用 libgit2 重写。
//! 防挂死:Tauri 子进程无 TTY —— GIT_TERMINAL_PROMPT=0 禁交互;
//! ssh 兜底 BatchMode+ConnectTimeout=10(仅当用户未自配 core.sshCommand /
//! GIT_SSH_COMMAND 时注入,不覆盖用户跳板/端口配置)。
//!
//! 调用纪律:必须经 with_repo 持内层锁执行(commands 层保证)——
//! pull 移动 HEAD/重写 index 期间,轮询的 status 并发读会撞 index.lock。
//!
//! pull 尊重用户 pull.rebase 配置,不擅自改写 merge/rebase 语义。

use git2::Repository;
use std::process::Command;

use super::GitError;
/// 网络操作总时限:到点 kill,释放 per-cwd 互斥锁(面板冻结的最后防线)。
const REMOTE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);
/// try_wait 轮询间隔。
const REMOTE_POLL: std::time::Duration = std::time::Duration::from_millis(200);

/// 排空子进程管道到缓冲(独立线程):防子进程写满管道缓冲自我阻塞。
fn drain_pipe<R: std::io::Read + Send + 'static>(
    pipe: Option<R>,
) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut p) = pipe {
            let _ = std::io::Read::read_to_end(&mut p, &mut buf);
        }
        buf
    })
}

#[derive(Debug, Clone, Copy)]
pub enum RemoteOp {
    Fetch,
    Pull,
    Push,
}

pub fn run(
    repo: &Repository,
    cwd: &str,
    op: RemoteOp,
    branch: Option<String>,
) -> Result<String, GitError> {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd).env("GIT_TERMINAL_PROMPT", "0");

    // 用户未自配 sshCommand 时才注入无交互兜底
    let user_has_ssh_cfg = repo
        .config()
        .ok()
        .and_then(|c| c.get_string("core.sshCommand").ok())
        .is_some()
        || std::env::var("GIT_SSH_COMMAND").is_ok();
    if !user_has_ssh_cfg {
        cmd.env(
            "GIT_SSH_COMMAND",
            "ssh -o BatchMode=yes -o ConnectTimeout=10",
        );
    }

    match op {
        RemoteOp::Fetch => {
            cmd.args(["fetch", "--all", "--prune"]);
        }
        RemoteOp::Pull => {
            cmd.arg("pull");
        }
        RemoteOp::Push => {
            cmd.arg("push");
            if let Some(b) = branch.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                if b.starts_with('-') {
                    return Err(GitError::empty(format!("非法分支名: {b}")));
                }
                cmd.args(["origin", b]);
            }
        }
    }

    /* 总时长上限:ConnectTimeout 只护 TCP connect 阶段,传输中途的网络停滞
     * (或用户自配 sshCommand)仍可无限挂起 —— 而本调用全程持 per-cwd 互斥锁,
     * 超时是防面板冻结与轮询堆积的最后防线。kill 后由读者线程收尾,不 join。 */
    let mut child = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| GitError::shell(format!("git 启动失败: {e}")))?;
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    /* 双管道即刻并发排空:防子进程写满管道缓冲自我阻塞 */
    let out_thread = drain_pipe(stdout_pipe);
    let err_thread = drain_pipe(stderr_pipe);

    let started = std::time::Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Ok(None) => {
                if started.elapsed() >= REMOTE_TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    /* 不 join 读线程:git 的 ssh 孙进程可能仍握管道写端,
                     * join 会把锁持有时间拖到孙进程消亡 —— 线程随 buf 丢弃 */
                    return Err(GitError::empty(
                        "git 网络操作超时(>300s),已中止;请检查网络/远端后重试",
                    ));
                }
                std::thread::sleep(REMOTE_POLL);
            }
            Err(e) => return Err(GitError::shell(format!("git 等待失败: {e}"))),
        }
    };
    let stdout = out_thread.join().unwrap_or_default();
    let stderr = err_thread.join().unwrap_or_default();
    let mut combined = String::from_utf8_lossy(&stdout).into_owned();
    if !stderr.is_empty() {
        if !combined.ends_with('\n') && !combined.is_empty() {
            combined.push('\n');
        }
        combined.push_str(&String::from_utf8_lossy(&stderr));
    }
    if !status.success() {
        return Err(GitError::from_shell_output(&combined));
    }
    Ok(combined)
}
