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

/// fetch 前后对比的引用快照:远端跟踪引用 + 自动跟随的 tag(只看 remotes 会把
/// tag 更新误报「已是最新」,2026-09-20 修)。
pub(super) fn remote_refs_snapshot(repo: &Repository) -> HashMap<String, Oid> {
    let mut out = HashMap::new();
    for glob in ["refs/remotes/**", "refs/tags/**"] {
        if let Ok(refs) = repo.references_glob(glob) {
            for r in refs.flatten() {
                let (Some(name), Some(target)) = (r.name().map(str::to_string), r.target()) else {
                    continue;
                };
                out.insert(name, target);
            }
        }
    }
    out
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

/// pull 前 staged 路径集(HEAD→index 双侧路径):HEAD 不动的报告用它排除既有暂存。
pub(super) fn staged_paths(repo: &Repository) -> std::collections::HashSet<String> {
    let head_tree = head_oid(repo)
        .and_then(|o| repo.find_commit(o).ok())
        .and_then(|c| c.tree().ok());
    let mut out = std::collections::HashSet::new();
    if let Ok(diff) = repo.diff_tree_to_index(head_tree.as_ref(), None, None) {
        for d in diff.deltas() {
            if let Some(p) = d.old_file().path().and_then(|p| p.to_str()) {
                out.insert(p.to_string());
            }
            if let Some(p) = d.new_file().path().and_then(|p| p.to_str()) {
                out.insert(p.to_string());
            }
        }
    }
    out
}

/// pull 完成明细:HEAD 动了 = 对比 FETCH_HEAD(来自远端的提交数,rebase 重放不计)
/// + 前后树 diff;HEAD 不动 = --no-commit/--squash 的暂存态或已是最新。
///
/// 既有暂存(pull 前已 staged 的路径)不计入。
pub(super) fn pull_report(
    repo: &Repository,
    head_before: Option<Oid>,
    staged_before: &std::collections::HashSet<String>,
) -> RemoteOpReport {
    let head_after = head_oid(repo);
    if head_before == head_after {
        let head_tree = head_after
            .and_then(|o| repo.find_commit(o).ok())
            .and_then(|c| c.tree().ok());
        /* 逐 delta 聚合,跳过 pull 前就 staged 的路径:--no-commit/--squash 混着
         * 用户既有暂存时,既有部分不算「拉取带来的变更」(2026-09-20 修虚高)。 */
        let diff = repo.diff_tree_to_index(head_tree.as_ref(), None, None);
        let mut files = 0usize;
        let mut ins = 0usize;
        let mut del = 0usize;
        if let Ok(diff) = diff {
            for (i, d) in diff.deltas().enumerate() {
                let old = d.old_file().path().and_then(|p| p.to_str());
                let new = d.new_file().path().and_then(|p| p.to_str());
                let pre = old.map(|p| staged_before.contains(p)).unwrap_or(false)
                    || new.map(|p| staged_before.contains(p)).unwrap_or(false);
                if pre {
                    continue;
                }
                if let Ok(Some(p)) = git2::Patch::from_diff(&diff, i) {
                    let (_, a, dl) = p.line_stats().unwrap_or((0, 0, 0));
                    files += 1;
                    ins += a;
                    del += dl;
                }
            }
        }
        if files == 0 {
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
            files,
            insertions: ins,
            deletions: del,
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
