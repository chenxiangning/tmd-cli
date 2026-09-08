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
//!
//! 两条入口:
//! - `run`:面板/右键菜单的快速操作(裸参数,尊重仓库配置);
//! - `run_request`:远端对话框的结构化请求(选项拼装语义对齐 codemoss)。

use git2::Repository;
use std::process::Command;

use super::GitError;

// 拆分后保持 remote_ops::* 引用契约:参数组装与对话框请求层经此处 re-export。
pub(super) use super::remote_args::{fetch_args, pull_args, push_args};
pub use super::remote_request::{run_request, RemoteRequest};

/// 网络操作总时限:到点 kill,释放 per-cwd 互斥锁(面板冻结的最后防线)。
const REMOTE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);
/// try_wait 轮询间隔。
const REMOTE_POLL: std::time::Duration = std::time::Duration::from_millis(200);
/// 退出后管道排空等待上限:git 的 ssh 孙进程(ControlMaster/GCM)可能
/// 握管道写端不撒手,join/无限等会把锁拖到孙进程消亡。
const PIPE_DRAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// 排空子进程管道并把结果发回 channel(独立线程):防子进程写满管道缓冲
/// 自我阻塞。不 join:收集端 recv_timeout 兜底(超时/放弃路径直接丢接收端)。
fn drain_pipe<R: std::io::Read + Send + 'static>(
    pipe: Option<R>,
) -> std::sync::mpsc::Receiver<Vec<u8>> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut p) = pipe {
            let _ = std::io::Read::read_to_end(&mut p, &mut buf);
        }
        let _ = tx.send(buf);
    });
    rx
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
    let mut args: Vec<String> = Vec::new();
    match op {
        RemoteOp::Fetch => {
            args.push("fetch".into());
            if let Some(b) = non_empty_branch(&branch)? {
                args.extend(fetch_args(repo, &b)?);
            } else {
                args.extend(["--all".into(), "--prune".into()]);
            }
        }
        RemoteOp::Pull => {
            let b = non_empty_branch(&branch)?;
            match b {
                Some(b) => {
                    let extra = pull_args(repo, &b)?;
                    if extra.is_empty() {
                        args.push("pull".into());
                    } else {
                        // 非当前分支:仅 fast-forward 上游引用,等价 git fetch <远端> <上游>:<分支>
                        // (merge/rebase 只对已检出分支有意义;git pull 无子命令,fetch 不能作其参数)
                        args.push("fetch".into());
                        args.extend(extra);
                    }
                }
                None => args.push("pull".into()),
            }
        }
        RemoteOp::Push => {
            args.push("push".into());
            if let Some(b) = non_empty_branch(&branch)? {
                args.extend(push_args(repo, &b)?);
            }
        }
    }
    exec_git(repo, cwd, &args)
}

/// 组装并执行 git 命令:非交互环境 + 总时长上限 + 双管道排空。
pub(super) fn exec_git(repo: &Repository, cwd: &str, args: &[String]) -> Result<String, GitError> {
    let mut cmd = Command::new("git");
    /* LC_ALL=C:git stderr 按英文输出,from_shell_output 的凭据特征分类
     * 才不随用户 locale 漂移(zh_CN 等本地化消息会漏判 E_AUTH)。 */
    cmd.current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .env("LANG", "C");
    crate::resolve::hide_console(&mut cmd);

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
    cmd.args(args);

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
    let out_rx = drain_pipe(stdout_pipe);
    let err_rx = drain_pipe(stderr_pipe);

    let started = std::time::Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Ok(None) => {
                if started.elapsed() >= REMOTE_TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    /* 不 join 读线程:git 的 ssh 孙进程可能仍握管道写端,
                     * join 会把锁持有时间拖到孙进程消亡 —— 接收端直接丢弃 */
                    return Err(GitError::empty(
                        "git 操作超时(>300s),已中止;请检查网络/远端后重试",
                    ));
                }
                std::thread::sleep(REMOTE_POLL);
            }
            Err(e) => return Err(GitError::shell(format!("git 等待失败: {e}"))),
        }
    };
    /* 正常退出后管道排空同样可能被孙进程拖住 —— 与超时路径同规则有限等待 */
    let stdout = out_rx.recv_timeout(PIPE_DRAIN_TIMEOUT).unwrap_or_default();
    let stderr = err_rx.recv_timeout(PIPE_DRAIN_TIMEOUT).unwrap_or_default();
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

/// 归一化:空串 → None;非法(以 - 开头)→ E_EMPTY。
pub(super) fn non_empty_branch(branch: &Option<String>) -> Result<Option<String>, GitError> {
    let b = branch.as_deref().map(str::trim).filter(|s| !s.is_empty());
    match b {
        Some(s) if s.starts_with('-') => Err(GitError::empty(format!("非法分支名: {s}"))),
        Some(s) => Ok(Some(s.to_string())),
        None => Ok(None),
    }
}

/// 已配置远端名列表(配置序)。
pub fn remotes(repo: &Repository) -> Result<Vec<String>, GitError> {
    let list = repo.remotes()?;
    Ok((0..list.len())
        .filter_map(|i| list.get(i).map(str::to_string))
        .collect())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushPreview {
    pub source_branch: String,
    /// 远端目标引用是否存在(false = 新分支首推)
    pub target_found: bool,
    pub has_more: bool,
    pub commits: Vec<super::log::LogEntry>,
}

/// 推送预览:HEAD 相对 `refs/remotes/<remote>/<branch>` 的独有提交(新→旧)。
/// 目标引用不存在 → 全部分支提交入列,target_found=false(新分支首推)。
pub fn push_preview(
    repo: &Repository,
    remote: &str,
    branch: &str,
    limit: usize,
) -> Result<PushPreview, GitError> {
    if branch.starts_with('-') || remote.starts_with('-') || remote.contains('/') {
        return Err(GitError::empty(format!("非法目标: {remote}/{branch}")));
    }
    let head = repo.head()?;
    if !head.is_branch() {
        return Err(GitError::empty("HEAD 不在分支上,无可推送预览"));
    }
    let source_branch = head.shorthand().unwrap_or("HEAD").to_string();
    let source_oid = head
        .target()
        .ok_or_else(|| GitError::empty("HEAD 未指向提交"))?;
    let target_ref = format!("refs/remotes/{remote}/{branch}");
    let target_oid = repo.refname_to_id(&target_ref).ok();
    let mut revwalk = repo.revwalk()?;
    revwalk.push(source_oid)?;
    if let Some(t) = target_oid {
        revwalk.hide(t)?;
    }
    revwalk.set_sorting(git2::Sort::TIME | git2::Sort::TOPOLOGICAL)?;
    let mut commits = Vec::with_capacity(limit);
    let mut has_more = false;
    for oid in revwalk {
        if commits.len() >= limit {
            has_more = true;
            break;
        }
        commits.push(super::log::entry(
            repo,
            oid?,
            &std::collections::HashMap::new(),
        )?);
    }
    Ok(PushPreview {
        source_branch,
        target_found: target_oid.is_some(),
        has_more,
        commits,
    })
}
