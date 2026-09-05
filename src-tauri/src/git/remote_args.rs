//! 远端参数组装与 upstream 解析 —— 自 remote_ops.rs 拆出(文件规模铁则)。
//! push/pull/fetch 的裸参数契约 + <远端>/<分支> 拆分原语;对话框请求层见 remote_request.rs。

use git2::{BranchType, Repository};

use super::GitError;

/// push 附加参数(带分支 = 显式目标,非当前分支也可推):
/// 有 upstream `origin/x` → `origin <b>:x`(推到其上游同名分支);
/// 无 upstream(新分支)→ `-u <首个远端> <b>` 推送并建跟踪;
/// upstream 不是 <远端>/<分支> 形态(罕见)→ 空,退回裸 push 尊重配置。
pub(super) fn push_args(repo: &Repository, branch: &str) -> Result<Vec<String>, GitError> {
    if let Some((remote, up)) = upstream_split(repo, branch) {
        return Ok(vec![remote, format!("{branch}:{up}")]);
    }
    let no_upstream = repo
        .find_branch(branch, BranchType::Local)
        .ok()
        .and_then(|b| b.upstream().ok())
        .is_none();
    if !no_upstream {
        return Ok(Vec::new());
    }
    let remote = first_remote(repo)?;
    Ok(vec!["-u".into(), remote, branch.to_string()])
}

/// pull 附加参数:当前分支 → 空(裸 pull,尊重 pull.rebase);非当前分支 →
/// `<远端> <上游>:<分支>` 仅 fast-forward 引用,不落工作区(merge/rebase 只对
/// 已检出分支有意义;run 层据此选 fetch 子命令)。无 upstream → E_EMPTY。
/// 非法分支名在此统一拒绝。
pub(super) fn pull_args(repo: &Repository, branch: &str) -> Result<Vec<String>, GitError> {
    let current = repo
        .head()
        .ok()
        .filter(|h| h.is_branch())
        .and_then(|h| h.shorthand().map(str::to_string));
    if current.as_deref() == Some(branch) {
        return Ok(Vec::new());
    }
    if branch.starts_with('-') {
        return Err(GitError::empty(format!("非法分支名: {branch}")));
    }
    let (remote, up) = upstream_split(repo, branch)
        .ok_or_else(|| GitError::empty(format!("分支 {branch} 无 upstream,无法更新")))?;
    Ok(vec![remote, format!("{up}:{branch}")])
}

/// fetch 附加参数(带分支 = 只刷新该分支的上游引用,不 --all):
/// 分支名是远程分支(origin/x)→ fetch 该远端分支;本地分支 → fetch 其上游;
/// 无 upstream → E_EMPTY。
pub(super) fn fetch_args(repo: &Repository, branch: &str) -> Result<Vec<String>, GitError> {
    if let Some((remote, short)) = split_remote(repo, branch) {
        return Ok(vec![remote, short]);
    }
    let (remote, up) = upstream_split(repo, branch)
        .ok_or_else(|| GitError::empty(format!("分支 {branch} 无 upstream,无法获取")))?;
    Ok(vec![remote, up])
}

/// 本地分支 → 其上游拆 <远端名>/<上游短名>;无 upstream 或形态不符 → None。
pub(super) fn upstream_split(repo: &Repository, branch: &str) -> Option<(String, String)> {
    let local = repo.find_branch(branch, BranchType::Local).ok()?;
    let up = local.upstream().ok()?;
    let up_name = up.name().ok().flatten()?.to_string();
    split_remote(repo, &up_name)
}

/// 按已配置远端列表拆 <远端名>/<短名>;不匹配任何远端 → None。
pub(super) fn split_remote(repo: &Repository, full: &str) -> Option<(String, String)> {
    let remotes = repo.remotes().ok()?;
    let mut i = 0;
    while let Some(r) = remotes.get(i) {
        if let Some(short) = full.strip_prefix(&format!("{r}/")) {
            if !short.is_empty() {
                return Some((r.to_string(), short.to_string()));
            }
        }
        i += 1;
    }
    None
}

pub(super) fn first_remote(repo: &Repository) -> Result<String, GitError> {
    Ok(repo
        .remotes()?
        .get(0)
        .ok_or_else(|| GitError::empty("仓库未配置远端,请先 git remote add"))?
        .to_string())
}
