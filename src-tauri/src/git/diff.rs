//! diff —— 文件清单(轻量)+ 单文件 patch(按需)。
//!
//! 取 patch 的唯一正确路径:Diff::deltas() 找序号 → Patch::from_diff → to_buf。
//! staged=true 时 diff HEAD tree → index;false 时 diff index → workdir(含 untracked)。

use git2::{Delta, Diff, DiffOptions, Repository};
use serde::Serialize;

use super::GitError;

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FilePatch {
    pub path: String,
    pub old_path: Option<String>,
    pub kind: String,
    pub additions: u32,
    pub deletions: u32,
    /// unified diff 文本;binary 时为空串
    pub patch: String,
    pub binary: bool,
}

pub fn file_patch(
    repo: &Repository,
    path: &str,
    staged: bool,
    full: bool,
) -> Result<Option<FilePatch>, GitError> {
    /* 两段式(2026-09-20 收窄):扫描段不做单文件 pathspec 收窄 —— libgit2 的
     * head→index rename 在 status 挂旧路径,而树→index diff 的 rename delta 挂
     * 新路径,收窄到单路径会拆散 rename 配对(R 退化为 D/A);全仓窄上下文 diff
     * + find_similar 是 rename 语义正确的最小实现。
     * full 态第二段只对目标文件以 [旧,新] 双 pathspec + u32::MAX 上下文二次
     * diff —— 修掉「点开单文件全文 = 全仓所有已改文件的全文 patch 进内存」。 */
    let scan = build_diff(repo, staged)?;
    if !full {
        return file_patch_from_diff(&scan, path);
    }
    /* 目标 delta 的新旧双侧路径(rename 两侧都带上,保二次 diff 配对) */
    let target = scan.deltas().find_map(|d| {
        let hit = d.new_file().path().and_then(|p| p.to_str()) == Some(path)
            || d.old_file().path().and_then(|p| p.to_str()) == Some(path);
        hit.then(|| (d.old_file().path(), d.new_file().path()))
    });
    let Some((old_side, new_side)) = target else {
        return Ok(None);
    };

    let mut opts = DiffOptions::new();
    opts.include_untracked(true)
        .show_untracked_content(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .context_lines(u32::MAX)
        .interhunk_lines(0);
    if let Some(old) = old_side.as_ref() {
        opts.pathspec(old);
    }
    if let Some(new) = new_side.as_ref() {
        opts.pathspec(new);
    }
    let focused = build_with_opts(repo, staged, &mut opts)?;
    file_patch_from_diff(&focused, path)
}

/// build_diff 的 opts 外置形态(full 二次 diff 用;find_similar 同样必跑)。
fn build_with_opts<'r>(
    repo: &'r Repository,
    staged: bool,
    opts: &mut DiffOptions,
) -> Result<Diff<'r>, GitError> {
    let mut diff = if staged {
        let head_tree = repo.head().ok().map(|h| h.peel_to_tree()).transpose()?;
        let index = super::fresh_index(repo)?;
        repo.diff_tree_to_index(head_tree.as_ref(), Some(&index), Some(opts))?
    } else {
        let index = super::fresh_index(repo)?;
        repo.diff_index_to_workdir(Some(&index), Some(opts))?
    };
    diff.find_similar(None)?;
    Ok(diff)
}

/// diff 内单文件 patch 提取(path 按新路径 / rename 来源双侧匹配 delta)——
/// 三处消费(工作区 staged/unstaged、提交视图、分支 vs 工作树对比)共用的
/// 唯一正确路径:Diff::deltas() 找序号 → binary 短路 → Patch::from_diff
/// → line_stats → to_buf。
pub(super) fn file_patch_from_diff(diff: &Diff, path: &str) -> Result<Option<FilePatch>, GitError> {
    let idx = diff.deltas().enumerate().find_map(|(i, d)| {
        let hit = d.new_file().path().and_then(|p| p.to_str()) == Some(path)
            || d.old_file().path().and_then(|p| p.to_str()) == Some(path);
        hit.then_some(i)
    });
    let Some(idx) = idx else { return Ok(None) };

    let delta = diff.get_delta(idx).ok_or(GitError::empty("delta 丢失"))?;
    let kind = fold_delta(delta.status()).to_string();
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

    let mut patch = git2::Patch::from_diff(diff, idx)?.ok_or(GitError::empty("patch 生成失败"))?;
    // line_stats: (context, insertions, deletions)
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

fn build_diff<'r>(repo: &'r Repository, staged: bool) -> Result<Diff<'r>, GitError> {
    let mut opts = DiffOptions::new();
    opts.include_untracked(true)
        .show_untracked_content(true) // untracked 整文件按 Added 计行(stats/patch 抽屉)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .context_lines(3)
        .interhunk_lines(0);
    build_with_opts(repo, staged, &mut opts)
}

/// 低频聚合命令的返回单元 —— git_totals 独立命令用,不随 5s 轮询的 status 走。
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffTotals {
    pub insertions: u32,
    pub deletions: u32,
    /// 每文件 ±行数,供差异面板行内展示(staged 标记侧别:tree→index / index→workdir)
    pub files: Vec<DiffFileTotal>,
}

/// 单文件单侧 ±行数。binary 不计行(0/0 不入列);untracked 整文件计入 wt 侧。
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffFileTotal {
    pub path: String,
    pub staged: bool,
    pub insertions: u32,
    pub deletions: u32,
}

/// 聚合 ±行数:staged(HEAD→index)与 unstaged(index→workdir)两侧逐 delta 取
/// patch line_stats 求和 —— 与 DiffStats 聚合同源(内部同为 patch 行统计),聚合值
/// 恒等于 files 求和;path 取 new 侧、删除取 old 侧,与 status 清单口径一致。
pub fn totals_of(repo: &Repository) -> Result<DiffTotals, GitError> {
    let mut insertions = 0u32;
    let mut deletions = 0u32;
    let mut files = Vec::new();
    for staged in [true, false] {
        let diff = build_diff(repo, staged)?;
        for (idx, delta) in diff.deltas().enumerate() {
            let new_path = delta.new_file().path();
            let old_path = delta.old_file().path();
            let Some(path) = new_path.or(old_path) else {
                continue;
            };
            if delta.new_file().is_binary() || delta.old_file().is_binary() {
                continue;
            }
            let Some(patch) = git2::Patch::from_diff(&diff, idx)? else {
                continue;
            };
            // line_stats: (context, insertions, deletions)
            let (_ctx, adds, dels) = patch.line_stats()?;
            insertions += adds as u32;
            deletions += dels as u32;
            files.push(DiffFileTotal {
                path: path.to_string_lossy().into_owned(),
                staged,
                insertions: adds as u32,
                deletions: dels as u32,
            });
        }
    }
    Ok(DiffTotals {
        insertions,
        deletions,
        files,
    })
}

pub(crate) fn fold_delta(d: Delta) -> &'static str {
    match d {
        Delta::Added | Delta::Untracked => "A",
        Delta::Deleted => "D",
        Delta::Modified => "M",
        Delta::Renamed => "R",
        Delta::Copied => "C",
        Delta::Typechange => "T",
        Delta::Conflicted => "C",
        _ => "M",
    }
}
