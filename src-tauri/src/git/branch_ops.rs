//! branch —— 列表 / checkout / 创建 / 删除 / 重命名 / 合并 / 变基。

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
    out.sort_by_key(|b| std::cmp::Reverse(b.last_commit_when));
    Ok(out)
}

/// checkout:safe 模式 —— 脏工作区与目标分支冲突时拒绝并给出可读引导,
/// 绝不擅自 force(丢弃用户改动);无冲突的脏文件随切换携带(git 默认语义)。
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
    repo.checkout_tree(commit.as_object(), Some(&mut opts))
        .map_err(|e| checkout_conflict_error(name, e))?;
    repo.set_head(&format!("refs/heads/{name}"))?;
    Ok(())
}

/// safe 冲突 → 统一可读文案:本地未提交变动挡路,引导先提交/暂存。
fn checkout_conflict_error(branch: &str, e: git2::Error) -> GitError {
    GitError::empty(format!(
        "本地有未提交的变动与分支 {branch} 冲突,请先提交或暂存(stash)后再切换({})",
        e.message()
    ))
}

/// checkout 远程分支到本地:建同名本地分支(set_upstream 建跟踪)并切换。
/// `origin/feat/x` → 本地 `feat/x`(剥首个远端段);本地同名已存在 = E_EMPTY
/// 引导直接切换,绝不静默复用(避免关联到用户预期外的提交)。
/// safe 模式同 checkout:脏工作区冲突由 libgit2 拒绝。
pub fn checkout_remote(repo: &Repository, name: &str) -> Result<(), GitError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(GitError::empty("分支名为空"));
    }
    let remote_branch = repo.find_branch(name, BranchType::Remote)?;
    let local_name = name
        .split_once('/')
        .map(|(_, rest)| rest.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| GitError::empty(format!("非法远程分支名: {name}")))?;
    if repo.find_branch(local_name, BranchType::Local).is_ok() {
        return Err(GitError::empty(format!(
            "本地分支 {local_name} 已存在,请在本地列表直接切换"
        )));
    }
    let commit = remote_branch.get().peel_to_commit()?;
    let mut branch = repo.branch(local_name, &commit, false)?;
    branch.set_upstream(Some(name))?;
    let mut opts = git2::build::CheckoutBuilder::new();
    opts.safe();
    repo.checkout_tree(commit.as_object(), Some(&mut opts))
        .map_err(|e| {
            // 本地分支与跟踪已建成;解决工作区冲突后可在本地列表直接切换,无需重建
            GitError::empty(format!(
                "本地有未提交的变动与分支 {local_name} 冲突;\
                 本地分支已创建并跟踪 {name},解决冲突后可直接切换,无需重复检出({})",
                e.message()
            ))
        })?;
    repo.set_head(&format!("refs/heads/{local_name}"))?;
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

/// 重命名本地分支:shell-out `git branch -m`。不走 libgit2 Branch::rename:
/// CLI 版本保证 `branch.<new>.remote/merge` 跟踪配置随迁,与官方 git 行为一致;
/// 目标名已存在 / 非法名由 git 自身拒绝(stderr 经 E_SHELL 透传)。
pub fn rename(repo: &Repository, cwd: &str, old: &str, new: &str) -> Result<(), GitError> {
    let old = old.trim();
    let new = new.trim();
    if old.is_empty() || new.is_empty() {
        return Err(GitError::empty("分支名为空"));
    }
    super::remote_ops::exec_git(
        repo,
        cwd,
        &["branch".into(), "-m".into(), old.into(), new.into()],
    )
    .map(|_| ())
}

/// 合并分支到当前分支:shell-out `git merge <name>`,fast-forward 策略交给
/// 仓库/用户 git 配置(与 codemoss 同语义)。冲突时 git 非零退出、MERGE_HEAD
/// 中间态保留(E_SHELL 透传 CONFLICT 详情),由用户在终端 continue/abort 收尾。
pub fn merge(repo: &Repository, cwd: &str, name: &str) -> Result<(), GitError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(GitError::empty("分支名为空"));
    }
    super::remote_ops::exec_git(repo, cwd, &["merge".into(), name.into()]).map(|_| ())
}

/// 当前分支变基到 onto:shell-out `git rebase <onto>`。libgit2 rebase 需逐提交
/// 驱动且冲突状态机复杂;CLI 留标准 rebase-merge 中间态,幕布终端可直接接管。
pub fn rebase(repo: &Repository, cwd: &str, onto: &str) -> Result<(), GitError> {
    let onto = onto.trim();
    if onto.is_empty() {
        return Err(GitError::empty("变基目标分支名为空"));
    }
    super::remote_ops::exec_git(repo, cwd, &["rebase".into(), onto.into()]).map(|_| ())
}
