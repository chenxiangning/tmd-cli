//! commit_view —— 单提交文件清单 + 单文件 patch(历史 Graph 展开用)。
//!
//! 口径:提交 vs 首父(根提交 vs 空树),与 `git show` 一致;
//! merge 提交展示对首父的变更。rename 检测开 find_similar(同 diff.rs)。

use git2::{Delta, DiffOptions, Oid, Repository};
use serde::Serialize;

use super::diff::{fold_delta, FilePatch};
use super::GitError;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    /// 展示路径:rename/copy 取新路径,deleted 取旧路径
    pub path: String,
    /// rename/copy 的来源路径
    pub old_path: Option<String>,
    /// "M" | "A" | "D" | "R" | "C" | "T"
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
}

/// 提交(sha)对首父的 tree↔tree diff。sha 非法或提交不存在 → E_GIT2。
fn commit_diff<'r>(repo: &'r Repository, sha: &str) -> Result<git2::Diff<'r>, GitError> {
    let oid = Oid::from_str(sha)?;
    let commit = repo.find_commit(oid)?;
    let tree = commit.tree()?;
    let parent_tree = if commit.parent_count() > 0 {
        Some(commit.parent(0)?.tree()?)
    } else {
        // 根提交:对空树,全部条目按 Added 出
        None
    };
    let mut opts = DiffOptions::new();
    opts.context_lines(3).interhunk_lines(0);
    let mut diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut opts))?;
    diff.find_similar(None)?; // rename/copy 检测(默认 50% 相似度,同 diff.rs)
    Ok(diff)
}

/// delta 的展示路径:deleted 取旧路径(新路径在 libgit2 中不保证回填),
/// 其余取新路径、缺失时回退旧路径;非 UTF-8 lossy 保可见(同 diff.rs 口径)。
fn delta_display_path(delta: &git2::DiffDelta) -> String {
    let new_path = delta.new_file().path();
    let old_path = delta.old_file().path();
    let chosen = if delta.status() == Delta::Deleted {
        old_path.or(new_path)
    } else {
        new_path.or(old_path)
    };
    chosen
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// 提交文件清单(含逐文件 ± 行数;binary 不计行)。
pub fn files(repo: &Repository, sha: &str) -> Result<Vec<CommitFile>, GitError> {
    let diff = commit_diff(repo, sha)?;
    let mut out = Vec::new();
    for (idx, delta) in diff.deltas().enumerate() {
        let binary = delta.new_file().is_binary() || delta.old_file().is_binary();
        let (adds, dels) = if binary {
            (0, 0)
        } else {
            // binary / 无文本 patch 时 from_diff 返回 None → 记 0 行
            match git2::Patch::from_diff(&diff, idx)? {
                Some(p) => {
                    let (_ctx, a, d) = p.line_stats()?;
                    (a as u32, d as u32)
                }
                None => (0, 0),
            }
        };
        out.push(CommitFile {
            path: delta_display_path(&delta),
            old_path: delta
                .old_file()
                .path()
                .map(|p| p.to_string_lossy().into_owned()),
            status: fold_delta(delta.status()).to_string(),
            additions: adds,
            deletions: dels,
            binary,
        });
    }
    Ok(out)
}

/// 提交内单文件 patch:path 按 新路径 或 rename 来源路径 匹配 delta。
pub fn file_patch(repo: &Repository, sha: &str, path: &str) -> Result<Option<FilePatch>, GitError> {
    let diff = commit_diff(repo, sha)?;
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
