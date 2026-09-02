//! 索引操作 —— stage / unstage / discard。
//!
//! 全部经 fresh_index(read(true)) 入口:外部终端 git add 后内存 index 不 stale。
//! 单次调用内多文件一次 index.write() 原子落盘。

use git2::Repository;
use std::path::{Component, Path};

use super::{fresh_index, GitError};
/// 纵深防御:拒绝对路径与 `..` 分量(调用方是受信前端,但四条写路径统一校验)。
fn validate_rel_path(p: &str) -> Result<(), GitError> {
    let rel = Path::new(p);
    if rel.is_absolute() || rel.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(GitError::empty(format!("非法路径: {p}")));
    }
    Ok(())
}

/// stage:存在的路径 add_path;已删除的路径 remove_path(等价 git add -A <paths>)。
pub fn stage(repo: &Repository, paths: Vec<String>) -> Result<(), GitError> {
    if paths.is_empty() {
        return Err(GitError::empty("stage 路径为空"));
    }
    let workdir = repo
        .workdir()
        .ok_or(GitError::empty("bare repo 不支持 stage"))?;
    let mut index = fresh_index(repo)?;
    for p in &paths {
        let rel = Path::new(p);
        validate_rel_path(p)?;
        if workdir.join(rel).symlink_metadata().is_ok() {
            index.add_path(rel)?;
        } else {
            index.remove_path(rel)?;
        }
    }
    index.write()?;
    Ok(())
}

/// unstage:≡ git reset -- <paths>;libgit2 内置 reset_default 自填 stat,
/// 手工构造 IndexEntry 会留 stat 全 0 的"幽灵脏文件"。
pub fn unstage(repo: &Repository, paths: Vec<String>) -> Result<(), GitError> {
    if paths.is_empty() {
        return Err(GitError::empty("unstage 路径为空"));
    }
    for p in &paths {
        validate_rel_path(p)?;
    }
    let head = match repo.head() {
        Ok(h) => h.peel(git2::ObjectType::Commit)?,
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch => {
            return Err(GitError::empty("首个提交前无需 unstage"));
        }
        Err(e) => return Err(e.into()),
    };
    repo.reset_default(Some(&head), paths.iter().map(Path::new))?;
    Ok(())
}

/// discard:把该路径的工作区还原为 index 当前状态(≡ `git restore <paths>`)。
/// 「放弃工作区改动」承诺的准确实现:staged 内容保留(工作区回到暂存后的样子),
/// 仅丢弃暂存之后的增量;untracked 不在 index,checkout_index 天然不碰。
/// 历史教训:曾用 checkout_head+force,会把已暂存内容一并销毁,超出 UI 告示范围。
pub fn discard(repo: &Repository, paths: Vec<String>) -> Result<(), GitError> {
    if paths.is_empty() {
        return Err(GitError::empty("discard 路径为空"));
    }
    for p in &paths {
        validate_rel_path(p)?;
    }
    let mut opts = git2::build::CheckoutBuilder::new();
    for p in &paths {
        opts.path(p);
    }
    /* force:覆盖工作区已修改文件;disable_pathspec_match:字面整路径匹配,
     * 防 `a[1].txt` 之类文件名被当 glob 展开误伤 */
    opts.force().disable_pathspec_match(true);
    let mut index = fresh_index(repo)?;
    repo.checkout_index(Some(&mut index), Some(&mut opts))?;
    Ok(())
}
