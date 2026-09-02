//! branch —— 列表 / checkout / 创建 / 删除。

use git2::{BranchType, Repository};
use serde::Serialize;

use super::GitError;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
    pub last_commit_sha: String,
    pub last_commit_summary: String,
    /// unix 秒
    pub last_commit_when: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BranchList {
    pub local: Vec<BranchInfo>,
    pub remote: Vec<BranchInfo>,
}

pub fn list_all(repo: &Repository) -> Result<BranchList, GitError> {
    let head_name = repo
        .head()
        .ok()
        .filter(|h| h.is_branch())
        .and_then(|h| h.shorthand().map(str::to_string));
    Ok(BranchList {
        local: collect(repo, BranchType::Local, head_name.as_deref())?,
        remote: collect(repo, BranchType::Remote, head_name.as_deref())?,
    })
}

fn collect(
    repo: &Repository,
    kind: BranchType,
    head: Option<&str>,
) -> Result<Vec<BranchInfo>, GitError> {
    let is_remote = matches!(kind, BranchType::Remote);
    let mut out = Vec::new();
    for item in repo.branches(Some(kind))? {
        let (branch, _) = item?;
        let Some(name) = branch.name()?.map(str::to_string) else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        // 远程 HEAD 符号引用(origin/HEAD → origin/main)不入列
        if is_remote && name.ends_with("/HEAD") {
            continue;
        }
        let upstream = branch
            .upstream()
            .ok()
            .and_then(|u| u.name().ok().flatten().map(str::to_string));
        let Ok(commit) = branch.get().peel_to_commit() else {
            continue;
        };
        out.push(BranchInfo {
            is_head: !is_remote && head == Some(name.as_str()),
            name,
            is_remote,
            upstream,
            last_commit_sha: commit.id().to_string(),
            last_commit_summary: commit.summary().unwrap_or("").to_string(),
            last_commit_when: commit.time().seconds(),
        });
    }
    out.sort_by(|a, b| b.last_commit_when.cmp(&a.last_commit_when));
    Ok(out)
}

/// checkout:safe 模式,脏工作区冲突由 libgit2 拒绝(前端拿到 E_GIT2 后 confirm 引导)。
pub fn checkout(repo: &Repository, name: &str) -> Result<(), GitError> {
    if name.trim().is_empty() {
        return Err(GitError::empty("分支名为空"));
    }
    let branch = repo.find_branch(name, BranchType::Local)?;
    if branch.is_head() {
        return Ok(()); // 幂等:已在目标分支
    }
    let commit = branch.get().peel_to_commit()?;
    let mut opts = git2::build::CheckoutBuilder::new();
    opts.safe();
    repo.checkout_tree(commit.as_object(), Some(&mut opts))?;
    repo.set_head(&format!("refs/heads/{name}"))?;
    Ok(())
}

/// 创建分支;from 缺省 = HEAD。不重名(libgit2 force=false 自带校验)。
pub fn create(repo: &Repository, name: &str, from: Option<String>) -> Result<(), GitError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(GitError::empty("分支名为空"));
    }
    let target = match from.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(reference) => repo.revparse_single(reference)?.peel_to_commit()?,
        None => match repo.head() {
            Ok(h) => h.peel_to_commit()?,
            Err(e) if e.code() == git2::ErrorCode::UnbornBranch => {
                return Err(GitError::empty("仓库尚无提交,请先完成首个提交"));
            }
            Err(e) => return Err(e.into()),
        },
    };
    repo.branch(name, &target, false)?;
    Ok(())
}

/// 删除本地分支;当前分支拒绝(force 仅控制未合并检查)。
pub fn delete(repo: &Repository, name: &str, force: bool) -> Result<(), GitError> {
    let mut branch = repo.find_branch(name, BranchType::Local)?;
    if branch.is_head() {
        return Err(GitError::empty("不能删除当前分支"));
    }
    if !force {
        // 未合并到 HEAD 的分支拒绝删除(等价 git branch -d vs -D)
        let head_commit = repo.head()?.peel_to_commit()?;
        let branch_commit = branch.get().peel_to_commit()?;
        let merged = repo.graph_descendant_of(head_commit.id(), branch_commit.id())?
            || head_commit.id() == branch_commit.id();
        if !merged {
            return Err(GitError::empty(format!(
                "分支 {name} 未合并到 HEAD,需 force 删除"
            )));
        }
    }
    branch.delete()?;
    Ok(())
}
