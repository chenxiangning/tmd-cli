//! stash —— 「暂存并切换」(复刻 IDEA Smart Checkout)。
//!
//! 直接切换本来就携带不冲突的未提交改动(safe checkout 语义);本模块处理
//! 冲突场景:stash -u(连 untracked)→ 切换 → apply 恢复。
//! 注意 libgit2 的 stash_pop 与 git CLI 不同:冲突时也返回 Ok 并丢弃 stash
//! (实测),故这里用 stash_apply + index.has_conflicts() 显式判冲,
//! 冲突时保留 stash 不丢,文件已标冲突,由用户在编辑器解决。

use git2::Repository;

use super::{branch_ops, status, GitError};

const STASH_MSG: &str = "tmd: 分支切换前自动暂存";

fn push(repo: &mut Repository) -> Result<bool, GitError> {
    let st = status::compute(repo)?;
    if st.files.is_empty() {
        return Ok(false);
    }
    if st.files.iter().any(|f| f.status == "C") {
        return Err(GitError::empty(
            "工作区存在未解决的合并冲突,请先解决冲突后再切换",
        ));
    }
    // stash_save 必须显式签名:复用提交面板的兜底链(config → env → 内置),不因缺 user 配置炸掉
    let sig = super::commit::resolve_signature(repo)?;
    repo.stash_save(&sig, STASH_MSG, Some(git2::StashFlags::INCLUDE_UNTRACKED))?;
    Ok(true)
}

fn checkout_by(repo: &Repository, name: &str, remote: bool) -> Result<(), GitError> {
    if remote {
        branch_ops::checkout_remote(repo, name)
    } else {
        branch_ops::checkout(repo, name)
    }
}

/// 恢复 stash[0]:apply 后按 index 冲突态分派 —— 干净则 drop,冲突则保留。
fn restore(repo: &mut Repository, name: &str) -> Result<(), GitError> {
    repo.stash_apply(0, None).map_err(|e| {
        GitError::empty(format!(
            "已切换到 {name};恢复暂存改动失败,改动仍保留在 stash \
             (git stash pop 重试 / git stash drop 丢弃)({})",
            e.message()
        ))
    })?;
    if repo.index()?.has_conflicts() {
        return Err(GitError::empty(format!(
            "已切换到 {name};暂存的改动与目标分支有冲突,已标记在文件中,请解决后提交。\
             原改动仍保留在 stash(确认无误后 git stash drop 丢弃)"
        )));
    }
    repo.stash_drop(0)?;
    Ok(())
}

/// 还原一次「暂存并切换」:reset --hard 丢弃切换后分支上的冲突标记与携带改动
/// (内容都在 stash 里),切回原分支,再 apply 恢复。
/// 无 stash 时拒绝 —— 没有备份时 reset 是纯丢弃,绝不盲目执行。
pub fn undo(repo: &mut Repository, original: &str) -> Result<(), GitError> {
    let mut n = 0;
    repo.stash_foreach(|_, _, _| {
        n += 1;
        true
    })?;
    if n == 0 {
        return Err(GitError::empty(
            "没有找到切换时自动暂存的改动,无可还原内容(可能已成功应用或被丢弃)",
        ));
    }
    {
        // Commit 带 Drop,借用须在 &mut 使用前结束 —— 作用域化
        let head_commit = repo.head()?.peel_to_commit()?;
        repo.reset(head_commit.as_object(), git2::ResetType::Hard, None)?;
    }
    branch_ops::checkout(repo, original)?;
    restore(repo, original)
}

/// 智能切换:干净直切;脏 → stash → 切换 → apply 恢复(冲突保留 stash)。
pub fn smart_checkout(repo: &mut Repository, name: &str, remote: bool) -> Result<(), GitError> {
    if !push(repo)? {
        return checkout_by(repo, name, remote);
    }
    if let Err(e) = checkout_by(repo, name, remote) {
        // 极少:干净树切换仍失败(如引用被并发改写)。apply 恢复现场(不 drop,安全优先)。
        let _ = repo.stash_apply(0, None);
        return Err(e);
    }
    restore(repo, name)
}
