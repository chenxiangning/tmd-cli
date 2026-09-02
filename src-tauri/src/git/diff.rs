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
) -> Result<Option<FilePatch>, GitError> {
    /* 不做单文件 pathspec 收窄:libgit2 的 head→index rename 在 status 挂旧路径,
     * 而树→index diff 的 rename delta 挂新路径 —— 收窄到单路径会拆散 rename 配对
     * (R 退化为 D/A)。全仓 diff + find_similar 是 rename 语义正确的最小实现。 */
    let diff = build_diff(repo, staged)?;
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

    let mut patch = git2::Patch::from_diff(&diff, idx)?.ok_or(GitError::empty("patch 生成失败"))?;
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
    let mut diff = if staged {
        // unborn HEAD(首个提交前):无 head tree → None 空 tree,index 全量视为 Added
        let head_tree = repo.head().ok().map(|h| h.peel_to_tree()).transpose()?;
        let index = super::fresh_index(repo)?;
        repo.diff_tree_to_index(head_tree.as_ref(), Some(&index), Some(&mut opts))?
    } else {
        let index = super::fresh_index(repo)?;
        repo.diff_index_to_workdir(Some(&index), Some(&mut opts))?
    };
    diff.find_similar(None)?; // rename/copy 检测(默认 50% 相似度)
    Ok(diff)
}

/// 低频聚合命令的返回单元 —— git_totals 独立命令用,不随 5s 轮询的 status 走。
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffTotals {
    pub insertions: u32,
    pub deletions: u32,
}

/// 聚合 ±行数:staged(HEAD→index)与 unstaged(index→workdir)两侧 stats 求和,
/// 与文件清单(status = idx ∪ wt)口径一致;binary/untracked 分别不计行/整文件计入。
pub fn totals_of(repo: &Repository) -> Result<DiffTotals, GitError> {
    let mut sums = (0u32, 0u32);
    for staged in [true, false] {
        let stats = build_diff(repo, staged)?.stats()?;
        sums.0 += stats.insertions() as u32;
        sums.1 += stats.deletions() as u32;
    }
    Ok(DiffTotals {
        insertions: sums.0,
        deletions: sums.1,
    })
}

fn fold_delta(d: Delta) -> &'static str {
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
