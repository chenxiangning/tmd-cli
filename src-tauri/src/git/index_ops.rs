//! 索引操作 —— stage / unstage / discard / clean。
//!
//! 全部经 fresh_index(read(true)) 入口:外部终端 git add 后内存 index 不 stale。
//! 单次调用内多文件一次 index.write() 原子落盘。

use git2::Repository;
use std::path::{Component, Path};

use super::{fresh_index, GitError};
/// 纵深防御:拒绝对路径与 `..` 分量(调用方是受信前端,但五条写路径统一校验)。
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

/// clean:删除未跟踪文件(≡ `git clean -f -- <paths>`)。
/// 本命令的删除目标集由文件系统而非 index 定义,防线集中在先行的全量校验
/// (先校验后删,绝不出现删了一半才发现撞线的半程状态):
/// - `.git` 分量拒绝:仓库元数据永不在 index,tracked 检查拦不住它;
/// - tracked = index 任意 stage(stage 1-3 = merge 冲突态,该态无 stage 0 条目);
/// - 盘上存在的路径 canonicalize 后必须落在仓内(中间符号链接分量逃逸),
///   并以 canonical 相对路径重查 index(igcase 卷上的大小写变体);
/// - 盘上已不存在的路径按幂等成功跳过(重复清理/竞态删除皆无副作用)。
pub fn clean(repo: &Repository, paths: Vec<String>) -> Result<(), GitError> {
    if paths.is_empty() {
        return Err(GitError::empty("clean 路径为空"));
    }
    for p in &paths {
        validate_rel_path(p)?;
    }
    let workdir = repo
        .workdir()
        .ok_or(GitError::empty("bare repo 不支持 clean"))?;
    let index = fresh_index(repo)?;
    let canon_root = workdir.canonicalize()?;
    for p in &paths {
        let rel = Path::new(p);
        if rel
            .components()
            .any(|c| matches!(c, Component::Normal(s) if s.eq_ignore_ascii_case(".git")))
        {
            return Err(GitError::empty(format!("拒绝删除仓库元数据: {p}")));
        }
        let is_tracked = |path: &Path| (0..=3).any(|s| index.get_path(path, s).is_some());
        if is_tracked(rel) {
            return Err(GitError::empty(format!("拒绝删除已跟踪文件: {p}")));
        }
        let abs = workdir.join(rel);
        let Ok(meta) = std::fs::symlink_metadata(&abs) else {
            continue; // 盘上不存在:删除循环按 NotFound 幂等跳过
        };
        // 父目录链 canonicalize 后必须仍落在仓内:拦中间符号链接分量逃逸
        let parent = rel.parent().unwrap_or_else(|| Path::new(""));
        let Ok(canon_parent) = workdir.join(parent).canonicalize() else {
            continue;
        };
        if !canon_parent.starts_with(&canon_root) {
            return Err(GitError::empty(format!("拒绝删除仓库外路径: {p}")));
        }
        if meta.file_type().is_symlink() {
            // 叶节点自身是 symlink:remove_file 只摘链接不跟随,放行(git clean 同义)
            continue;
        }
        // 常规文件:整路径 canonicalize —— igcase 卷上取回盘上真实大小写重查 index
        let Ok(canon) = abs.canonicalize() else {
            continue;
        };
        let Ok(rel_canon) = canon.strip_prefix(&canon_root) else {
            return Err(GitError::empty(format!("拒绝删除仓库外路径: {p}")));
        };
        if is_tracked(rel_canon) {
            return Err(GitError::empty(format!("拒绝删除已跟踪文件: {p}")));
        }
    }
    for p in &paths {
        match std::fs::remove_file(workdir.join(Path::new(p))) {
            Ok(()) => {}
            // NotFound 与目录条目(嵌入仓 `sub/`)同样跳过:≡ git clean -f(无 -d)对二者的行为
            Err(e) if e.kind() == std::io::ErrorKind::NotFound || p.ends_with('/') => {}
            Err(e) => return Err(GitError::empty(format!("删除失败 {p}: {e}"))),
        }
    }
    Ok(())
}
