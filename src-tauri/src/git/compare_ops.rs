//! compare —— 分支对比(双向唯一提交)+ 工作树对分支差异(清单 / 单文件 patch)。
//!
//! 对比口径与 codemoss 一致:双向 revwalk push/hide(Sort::TOPOLOGICAL | TIME),
//! limit 缺省 200、clamp 1..500;提交复用 LogEntry(refs 装饰走 log::ref_map)。
//! 工作树对分支:branch tip tree → diff_tree_to_workdir_with_index(含 untracked)
//! 再 find_similar;对 codemoss 的重新实现点 —— codemoss 是 spawn git CLI 解析
//! name-status,这里 git2 进程内完成,零进程零文本解析;列表不带 patch,
//! 单文件 patch 按需走同款 diff(与 diff.rs::file_patch 同源模式)。

use git2::{BranchType, Repository, Sort};
use serde::Serialize;

use super::{diff, log, FilePatch, GitError, LogEntry};

/// 双列唯一提交:targetOnly = target 有 current 没有,反之 currentOnly。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BranchCompareSet {
    pub target_only: Vec<LogEntry>,
    pub current_only: Vec<LogEntry>,
}

/// 工作树对分支差异清单项(path 取 new 侧、删除取 old 侧,与 status 清单口径一致)。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BranchDiffFile {
    pub path: String,
    pub old_path: Option<String>,
    /// M / A / D / R / C / T(同 fold_delta 口径)
    pub status: String,
}

/// 分支对比:双向唯一提交列表。target==current 返回双空(菜单对当前分支禁用,
/// 此分支是命令层兜底);任一分支不存在由 find_branch_oid 报 E_GIT2 引导。
pub fn branch_compare(
    repo: &Repository,
    target: &str,
    current: &str,
    limit: Option<usize>,
) -> Result<BranchCompareSet, GitError> {
    let limit = limit.unwrap_or(200).clamp(1, 500);
    if target.trim() == current.trim() {
        return Ok(BranchCompareSet {
            target_only: Vec::new(),
            current_only: Vec::new(),
        });
    }
    let target_oid = find_branch_oid(repo, target)?;
    let current_oid = find_branch_oid(repo, current)?;
    let refs = log::ref_map(repo)?;
    Ok(BranchCompareSet {
        target_only: unique_commits(repo, target_oid, current_oid, limit, &refs)?,
        current_only: unique_commits(repo, current_oid, target_oid, limit, &refs)?,
    })
}

/// include 独有提交:revwalk(include) 隐藏 hide 可达提交,取前 limit 条。
fn unique_commits(
    repo: &Repository,
    include: git2::Oid,
    hide: git2::Oid,
    limit: usize,
    refs: &std::collections::HashMap<git2::Oid, Vec<String>>,
) -> Result<Vec<LogEntry>, GitError> {
    let mut rev = repo.revwalk()?;
    rev.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    rev.push(include)?;
    rev.hide(hide)?;
    let mut out = Vec::new();
    for oid in rev.take(limit) {
        out.push(log::entry(repo, oid?, refs)?);
    }
    Ok(out)
}

/// 分支名 → commit oid:refs/heads → refs/remotes → 裸 revparse 兜底
/// (允许 "main" / "origin/main" / 完整 ref 三种写法)。
fn find_branch_oid(repo: &Repository, name: &str) -> Result<git2::Oid, GitError> {
    let name = name.trim();
    for reference in [format!("refs/heads/{name}"), format!("refs/remotes/{name}")] {
        if let Ok(o) = repo.revparse_single(&reference) {
            return Ok(o.peel_to_commit()?.id());
        }
    }
    Ok(repo.revparse_single(name)?.peel_to_commit()?.id())
}

/// 工作树(含 index 与 untracked)对 branch tip 的 diff;find_similar 保 rename 配对。
fn branch_workdir_diff<'r>(repo: &'r Repository, branch: &str) -> Result<git2::Diff<'r>, GitError> {
    let branch = branch.trim();
    let tree = repo
        .find_branch(branch, BranchType::Local)
        .or_else(|_| repo.find_branch(branch, BranchType::Remote))?
        .get()
        .peel_to_tree()?;
    let mut opts = git2::DiffOptions::new();
    opts.include_untracked(true)
        .show_untracked_content(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .context_lines(3)
        .interhunk_lines(0);
    let mut diff = repo.diff_tree_to_workdir_with_index(Some(&tree), Some(&mut opts))?;
    diff.find_similar(None)?;
    Ok(diff)
}

/// 差异文件清单(不带 patch —— patch 按需单文件拉,避免大列表全量生成)。
pub fn worktree_files(repo: &Repository, branch: &str) -> Result<Vec<BranchDiffFile>, GitError> {
    let diff = branch_workdir_diff(repo, branch)?;
    let mut out = Vec::new();
    for d in diff.deltas() {
        let status = diff::fold_delta(d.status()).to_string();
        let new_path = d
            .new_file()
            .path()
            .map(|p| p.to_string_lossy().into_owned());
        let old_path = d
            .old_file()
            .path()
            .map(|p| p.to_string_lossy().into_owned());
        // 删除取 old 侧路径,其余取 new 侧(与 git_totals 清单口径一致)
        let path = if status == "D" {
            old_path.clone()
        } else {
            new_path
        };
        let Some(path) = path else { continue };
        // rename/copy 才有来源路径;同路径改动 old==new 不标 oldPath
        let old_path = if matches!(status.as_str(), "R" | "C") && old_path != Some(path.clone()) {
            old_path
        } else {
            None
        };
        out.push(BranchDiffFile {
            path,
            old_path,
            status,
        });
    }
    Ok(out)
}

/// 单文件 patch(path 按 新路径 / rename 来源 双侧匹配,同 diff.rs 纪律)。
pub fn worktree_patch(
    repo: &Repository,
    branch: &str,
    path: &str,
) -> Result<Option<FilePatch>, GitError> {
    let diff = branch_workdir_diff(repo, branch)?;
    let idx = diff.deltas().enumerate().find_map(|(i, d)| {
        let hit = d.new_file().path().and_then(|p| p.to_str()) == Some(path)
            || d.old_file().path().and_then(|p| p.to_str()) == Some(path);
        hit.then_some(i)
    });
    let Some(idx) = idx else {
        return Ok(None);
    };

    let delta = diff.get_delta(idx).ok_or(GitError::empty("delta 丢失"))?;
    let kind = diff::fold_delta(delta.status()).to_string();
    let old_path = delta
        .old_file()
        .path()
        .map(|p| p.to_string_lossy().into_owned());
    let binary = delta.new_file().is_binary() || delta.old_file().is_binary();
    if binary {
        return Ok(Some(FilePatch {
            path: path.into(),
            old_path,
            kind,
            additions: 0,
            deletions: 0,
            patch: String::new(),
            binary: true,
        }));
    }

    let mut patch = git2::Patch::from_diff(&diff, idx)?.ok_or(GitError::empty("patch 生成失败"))?;
    let (_ctx, adds, dels) = patch.line_stats()?;
    let buf = patch.to_buf()?;
    Ok(Some(FilePatch {
        path: path.into(),
        old_path,
        kind,
        additions: adds as u32,
        deletions: dels as u32,
        patch: String::from_utf8_lossy(&buf).into_owned(),
        binary: false,
    }))
}
