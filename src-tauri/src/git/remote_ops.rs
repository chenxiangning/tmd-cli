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

// 拆分后保持 remote_ops::* 引用契约:run 已拆 remote_quick.rs(参数组装随迁)。
pub use super::remote_request::{run_request, RemoteOpReport, RemoteRequest};

/// 网络操作总时限:到点 kill,释放 per-cwd 互斥锁(面板冻结的最后防线)。
/// 600s(2026-09-20 自 300s 放宽):慢上行推大产物 300s 常态触顶被中途 kill。
const REMOTE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);
/// try_wait 轮询间隔。
const REMOTE_POLL: std::time::Duration = std::time::Duration::from_millis(200);
/// 退出后管道排空等待上限:git 的 ssh 孙进程(ControlMaster/GCM)可能
/// 握管道写端不撒手,join/无限等会把锁拖到孙进程消亡。
pub(super) const PIPE_DRAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// 排空子进程管道并把结果发回 channel(独立线程):防子进程写满管道缓冲
/// 自我阻塞。不 join:收集端 recv_timeout 兜底(超时/放弃路径直接丢接收端)。
pub(super) fn drain_pipe<R: std::io::Read + Send + 'static>(
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

/// pull 专用执行:git ≥2.27 在 divergent 且未配置 pull.rebase 时直接 fatal
/// ("Need to specify how to reconcile divergent branches")。此处兜底:
/// --rebase 重试(无冲突 = 本地提交接到远端之后,直接完成更新);撞冲突则
/// abort 恢复原状并明确报错,不把半途 rebase 态留在工作区。fetch 引用刷新
/// (非当前分支)与显式策略错误不在此列,原样透传。
pub(super) fn exec_pull(repo: &Repository, cwd: &str, args: &[String]) -> Result<String, GitError> {
    match exec_git(repo, cwd, args) {
        Ok(out) => Ok(out),
        Err(GitError::Shell(s))
            if args.first().map(String::as_str) == Some("pull")
                && s.contains("divergent branches") =>
        {
            let mut retry = args.to_vec();
            retry.insert(1, "--rebase".into());
            match exec_git(repo, cwd, &retry) {
                Err(GitError::Shell(s2)) if s2.to_lowercase().contains("conflict") => {
                    let _ = exec_git(repo, cwd, &["rebase".into(), "--abort".into()]);
                    // abort 基本必成(工作区在 rebase 启动时已被 git 保证干净);
                    // 探测两个 rebase 后端目录;.git 是文件(linked worktree/submodule)时
                    // 本地拼路径不可靠,按「未确认恢复」处理,给 fallback 文案。
                    let dotgit = std::path::Path::new(cwd).join(".git");
                    let aborted = if dotgit.is_dir() {
                        !dotgit.join("rebase-merge").exists()
                            && !dotgit.join("rebase-apply").exists()
                    } else {
                        false
                    };
                    if aborted {
                        Err(GitError::empty(
                            "拉取有冲突:已中止并恢复原状,未改动任何文件;请到幕布终端执行 git pull 自行解决冲突",
                        ))
                    } else {
                        Err(GitError::empty(
                            "拉取有冲突,自动恢复未完成:本地提交与改动都还在,请到幕布终端执行 git rebase --abort 后自行处理",
                        ))
                    }
                }
                Ok(out) => Ok(out),
                Err(e) => Err(e),
            }
        }
        Err(e) => Err(e),
    }
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
                        "git 操作超时(>600s)已中止(超时≠网络故障判定);大传输请到幕布终端自行执行",
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
        /* 尾裁 500 字符:pre-receive 拒绝等长输出整段进横幅会刷屏 */
        let tail = if combined.chars().count() > 500 {
            let skip = combined.chars().count() - 500;
            format!("…{}", combined.chars().skip(skip).collect::<String>())
        } else {
            combined.clone()
        };
        return Err(GitError::from_shell_output(&tail));
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
