//! 远端快速操作 —— 面板/右键菜单的裸参数入口(自 remote_ops 拆出,文件规模铁则)。
//! 报告口径:pull=HEAD/暂存基线,fetch/pull 非当前分支=refs 快照,push=upstream 基线。

use git2::Repository;

use super::remote_args::{fetch_args, pull_args, push_args};
use super::remote_ops::{exec_git, exec_pull, non_empty_branch, RemoteOp};
pub use super::remote_request::RemoteOpReport;
use super::GitError;

pub fn run(
    repo: &Repository,
    cwd: &str,
    op: RemoteOp,
    branch: Option<String>,
) -> Result<RemoteOpReport, GitError> {
    let mut args: Vec<String> = Vec::new();
    let mut pull_as_fetch = false; // 非当前分支 pull = 仅 fast-forward 引用,refs 口径报告
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
                        pull_as_fetch = true;
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
    match op {
        RemoteOp::Pull if !pull_as_fetch => {
            let head_before = super::remote_report::head_oid(repo);
            let staged = super::remote_report::staged_paths(repo);
            exec_pull(repo, cwd, &args)?;
            Ok(super::remote_report::pull_report(
                repo,
                head_before,
                &staged,
            ))
        }
        _ if args.first().map(String::as_str) == Some("fetch") => {
            let before = super::remote_report::remote_refs_snapshot(repo);
            exec_git(repo, cwd, &args)?;
            Ok(refs_changed_report(repo, &before))
        }
        RemoteOp::Push => {
            /* 明细在 exec 前算(run_request push 同款):推的是远端缺的提交 */
            let (base, commits) = push_quick_stats(repo)?;
            exec_git(repo, cwd, &args)?;
            Ok(RemoteOpReport {
                up_to_date: base.is_some() && commits == 0,
                commits,
                ..Default::default()
            })
        }
        _ => unreachable!("pull_as_fetch 已被首支臂覆盖"),
    }
}

/// 快速 push(裸 push,branch 空)的推送量:当前分支 upstream 为基。
fn push_quick_stats(repo: &Repository) -> Result<(Option<git2::Oid>, usize), GitError> {
    let base = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .and_then(|name| {
            repo.find_branch(&name, git2::BranchType::Local)
                .ok()
                .and_then(|b| b.upstream().ok())
                .and_then(|u| u.get().target())
        });
    let commits = match super::remote_report::head_oid(repo) {
        Some(head) => super::remote_report::revwalk_ahead_count(repo, base, head),
        None => 0,
    };
    Ok((base, commits))
}

/// fetch 后 refs 变化报告(run_request fetch 同款口径)。
fn refs_changed_report(
    repo: &Repository,
    before: &std::collections::HashMap<String, git2::Oid>,
) -> RemoteOpReport {
    let after = super::remote_report::remote_refs_snapshot(repo);
    let changed = after
        .iter()
        .filter(|(k, v)| before.get(*k) != Some(v))
        .count()
        + before.keys().filter(|k| !after.contains_key(*k)).count();
    RemoteOpReport {
        up_to_date: changed == 0,
        refs: changed,
        ..Default::default()
    }
}
