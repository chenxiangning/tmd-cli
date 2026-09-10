//! ahead/behind —— 独立低频命令(fetch 完成 / 分支切换 / 手动刷新后调用)。
//!
//! - unborn HEAD / detached HEAD:返回零值。
//! - 无 upstream:降级统计 HEAD 可达而全部远端分支均不可达的提交数(behind 置 0),
//!   推送按钮/仓 chips 仍能给出「本地独有 N 个提交」的提示,不再静默归零。

use git2::{ErrorCode, Repository};
use serde::Serialize;

use super::GitError;

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AheadBehind {
    pub ahead: i32,
    pub behind: i32,
    pub upstream: Option<String>,
}

/// 低频命令:fetch 完成 / 分支切换 / 手动刷新后调用。unborn 返回零值。
pub fn ahead_behind(repo: &Repository) -> Result<AheadBehind, GitError> {
    let head = match repo.head() {
        Ok(h) => h,
        Err(e) if e.code() == ErrorCode::UnbornBranch => return Ok(AheadBehind::default()),
        Err(e) => return Err(e.into()),
    };
    if !head.is_branch() {
        return Ok(AheadBehind::default());
    }
    let branch = git2::Branch::wrap(head);
    let branch_ref = match branch.upstream() {
        Ok(u) => u,
        // 无 upstream:降级统计 HEAD 相对全部远端分支的唯一提交数(behind 置 0)。
        Err(_) => return head_unique_vs_remotes(repo, &branch),
    };
    let local_oid = branch
        .get()
        .target()
        .ok_or(GitError::empty("head 无 target"))?;
    let up_oid = branch_ref
        .get()
        .target()
        .ok_or(GitError::empty("upstream 无 target"))?;
    let (ahead, behind) = repo.graph_ahead_behind(local_oid, up_oid)?;
    Ok(AheadBehind {
        ahead: ahead as i32,
        behind: behind as i32,
        upstream: branch_ref.name()?.map(str::to_string),
    })
}

/// 无 upstream 时的降级统计:HEAD 可达而全部远端分支均不可达的提交数(behind 置 0)。
fn head_unique_vs_remotes(
    repo: &Repository,
    branch: &git2::Branch,
) -> Result<AheadBehind, GitError> {
    let local_oid = branch
        .get()
        .target()
        .ok_or(GitError::empty("head 无 target"))?;
    let mut walk = repo.revwalk()?;
    walk.push(local_oid)?;
    for remote in repo.branches(Some(git2::BranchType::Remote))? {
        let (b, _) = remote?;
        if let Some(oid) = b.get().target() {
            walk.hide(oid)?;
        }
    }
    Ok(AheadBehind {
        ahead: walk.filter_map(Result::ok).count() as i32,
        behind: 0,
        upstream: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ahead_behind_counts_unique_commits_without_upstream() {
        let dir = std::env::temp_dir().join(format!(
            "tmd-ab-noup-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let repo = git2::Repository::init(&dir).unwrap();
        {
            let mut cfg = repo.config().unwrap();
            cfg.set_str("user.name", "t").unwrap();
            cfg.set_str("user.email", "t@t").unwrap();
            let sig = repo.signature().unwrap();
            let mut index = repo.index().unwrap();
            std::fs::write(dir.join("a.txt"), "a").unwrap();
            index.add_path(std::path::Path::new("a.txt")).unwrap();
            index.write().unwrap();
            let base = repo
                .commit(
                    Some("HEAD"),
                    &sig,
                    &sig,
                    "base",
                    &repo.find_tree(index.write_tree().unwrap()).unwrap(),
                    &[],
                )
                .unwrap();
            // 远端引用指向 base,但本地分支不配 upstream → 走降级统计
            repo.reference("refs/remotes/origin/main", base, true, "test")
                .unwrap();
            std::fs::write(dir.join("b.txt"), "b").unwrap();
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("b.txt")).unwrap();
            index.write().unwrap();
            let parent = repo.head().unwrap().peel_to_commit().unwrap();
            repo.commit(
                Some("HEAD"),
                &sig,
                &sig,
                "tip",
                &repo.find_tree(index.write_tree().unwrap()).unwrap(),
                &[&parent],
            )
            .unwrap();

            let ab = ahead_behind(&repo).unwrap();
            assert_eq!(ab.ahead, 1, "tip 相对全部远端引用唯一 → 计 1");
            assert_eq!(ab.behind, 0);
            assert!(ab.upstream.is_none());
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
