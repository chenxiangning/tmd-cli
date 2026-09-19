//! 远端操作完成明细 —— fetch/pull/push 的统计采集(自 remote_request.rs 拆出,文件规模铁则)。

use std::collections::HashMap;

use git2::{Oid, Repository};
use serde::Serialize;

/// 远端操作完成明细(面板通知用;字段 camelCase 对齐 kernel/ipc 契约)。
/// fetch 用 refs,pull 用 commits/files/insertions/deletions,push 用 commits。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteOpReport {
    /// 无任何变化(已是最新)。
    pub up_to_date: bool,
    /// push=推送提交数;pull=来自远端的合入提交数。
    pub commits: usize,
    /// pull=变更文件数。
    pub files: usize,
    pub insertions: usize,
    pub deletions: usize,
    /// fetch=更新/新增/清理的远端引用数。
    pub refs: usize,
}

/// HEAD 指向的提交(未出生/异常 = None)。
pub(super) fn head_oid(repo: &Repository) -> Option<Oid> {
    repo.head().ok().and_then(|h| h.target())
}

/// refs/remotes/** 的 name→oid 快照(fetch 前后对比算更新数)。
pub(super) fn remote_refs_snapshot(repo: &Repository) -> HashMap<String, Oid> {
    repo.references_glob("refs/remotes/**")
        .map(|refs| {
            refs.flatten()
                .filter_map(|r| Some((r.name()?.to_string(), r.target()?)))
                .collect()
        })
        .unwrap_or_default()
}

/// from(不含)到 to 的提交数;from=None 数全部历史;from 非祖先(force 场景)同样成立
/// (hide 语义 = 远端已有的提交不计)。
pub(super) fn revwalk_ahead_count(repo: &Repository, from: Option<Oid>, to: Oid) -> usize {
    let Ok(mut walk) = repo.revwalk() else {
        return 0;
    };
    if walk.push(to).is_err() {
        return 0;
    }
    if let Some(f) = from {
        let _ = walk.hide(f);
    }
    walk.count()
}

/// 两树差异的 (files, insertions, deletions);任一树 None 视为空树。
fn tree_diff_stats(repo: &Repository, old: Option<Oid>, new: Option<Oid>) -> (usize, usize, usize) {
    let tree = |oid: Option<Oid>| {
        oid.and_then(|o| repo.find_commit(o).ok())
            .and_then(|c| c.tree().ok())
    };
    let (old, new) = (tree(old), tree(new));
    repo.diff_tree_to_tree(old.as_ref(), new.as_ref(), None)
        .and_then(|d| d.stats())
        .map(|s| (s.files_changed(), s.insertions(), s.deletions()))
        .unwrap_or((0, 0, 0))
}

/// pull 完成明细:HEAD 动了 = 对比 FETCH_HEAD(来自远端的提交数,rebase 重放不计)
/// + 前后树 diff;HEAD 不动 = --no-commit/--squash 的暂存态或已是最新。
///
/// ponytail:HEAD 不动时 diff HEAD→index,用户既有暂存会一并计入(已知上限)。
pub(super) fn pull_report(repo: &Repository, head_before: Option<Oid>) -> RemoteOpReport {
    let head_after = head_oid(repo);
    if head_before == head_after {
        let head_tree = head_after
            .and_then(|o| repo.find_commit(o).ok())
            .and_then(|c| c.tree().ok());
        let staged = repo
            .diff_tree_to_index(head_tree.as_ref(), None, None)
            .and_then(|d| d.stats())
            .map(|s| (s.files_changed(), s.insertions(), s.deletions()))
            .unwrap_or((0, 0, 0));
        if staged.0 == 0 {
            return RemoteOpReport {
                up_to_date: true,
                ..Default::default()
            };
        }
        /* --no-commit 合并:MERGE_HEAD 里是远端 tip;--squash 无 MERGE_HEAD,提交数 0。 */
        let commits = repo
            .find_reference("MERGE_HEAD")
            .ok()
            .and_then(|r| r.target())
            .map(|m| revwalk_ahead_count(repo, head_before, m))
            .unwrap_or(0);
        return RemoteOpReport {
            commits,
            files: staged.0,
            insertions: staged.1,
            deletions: staged.2,
            ..Default::default()
        };
    }
    let commits = repo
        .find_reference("FETCH_HEAD")
        .ok()
        .and_then(|r| r.target())
        .map(|f| revwalk_ahead_count(repo, head_before, f))
        .unwrap_or_else(|| match head_after {
            Some(a) => revwalk_ahead_count(repo, head_before, a),
            None => 0,
        });
    let (files, insertions, deletions) = tree_diff_stats(repo, head_before, head_after);
    RemoteOpReport {
        commits,
        files,
        insertions,
        deletions,
        ..Default::default()
    }
}
