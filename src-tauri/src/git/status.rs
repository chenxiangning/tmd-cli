//! status —— 当前分支 + 工作区变更清单;ahead/behind 独立低频命令。
//!
//! - detached HEAD 安全:先判 is_branch 再 shorthand。
//! - unborn HEAD(空仓库):head() 报 UnbornBranch —— branch 名从 HEAD
//!   symbolic ref 取,head_sha 置空,files 正常列(untracked 全出)。
//! - 冲突态:Status::CONFLICTED → "C"(staged=false,前端禁 stage/discard)。
//! - FileStatus.wt/idx 双轨:预览/提交一致性由前端按 wt 优先选 patch 侧。

use git2::{ErrorCode, Repository, Status, StatusOptions};
use serde::Serialize;

use super::GitError;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    /// 相对 repo root
    pub path: String,
    /// "M" | "A" | "D" | "R" | "T" | "C"(冲突)| "?"(untracked,前端渲染为 U)
    pub status: String,
    /// index 侧有变更(已暂存)
    pub staged: bool,
    /// 工作区侧有变更(staged=true 且 wt=true = 暂存后又改)
    pub wt: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiffStatus {
    /// 分支名;detached 时为 "detached@<短sha>"
    pub branch: String,
    /// unborn(无提交)时为空串
    pub head_sha: String,
    /// 上游分支名(如 origin/main);detached / 无上游为 None
    pub upstream: Option<String>,
    pub files: Vec<FileStatus>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AheadBehind {
    pub ahead: i32,
    pub behind: i32,
    pub upstream: Option<String>,
}

pub fn compute(repo: &Repository) -> Result<DiffStatus, GitError> {
    let (branch, head_sha, upstream) = match repo.head() {
        Ok(head) => {
            let sha = head.target().map(|o| o.to_string()).unwrap_or_default();
            if head.is_branch() {
                let name = head.shorthand().unwrap_or("HEAD").to_string();
                let up = upstream_name(repo, &name);
                (name, sha, up)
            } else {
                (format!("detached@{}", &sha[..7.min(sha.len())]), sha, None)
            }
        }
        Err(e) if e.code() == ErrorCode::UnbornBranch => {
            // 空仓库:HEAD 是 symbolic ref → refs/heads/<name>
            let name = repo
                .find_reference("HEAD")
                .ok()
                .and_then(|r| r.symbolic_target().map(str::to_string))
                .and_then(|t| t.strip_prefix("refs/heads/").map(str::to_string))
                .unwrap_or_else(|| "main".into());
            (name, String::new(), None)
        }
        Err(e) => return Err(e.into()),
    };

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .include_unmodified(false)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);
    let statuses = repo.statuses(Some(&mut opts))?;

    let files = statuses
        .iter()
        .map(|s| {
            /* 非 UTF-8 文件名(Linux 任意字节合法):此前 path() 返回 None 会被
             * filter_map 静默丢弃 → 文件从面板消失。改走 path_bytes + lossy 保可见。 */
            let path = String::from_utf8_lossy(s.path_bytes()).into_owned();
            let (status, staged, wt) = fold_status(s.status());
            FileStatus {
                path,
                status,
                staged,
                wt,
            }
        })
        .collect();

    Ok(DiffStatus {
        branch,
        head_sha,
        upstream,
        files,
    })
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
    let up = match branch.upstream() {
        Ok(u) => u,
        Err(_) => return Ok(AheadBehind::default()),
    };
    let local_oid = branch
        .get()
        .target()
        .ok_or(GitError::empty("head 无 target"))?;
    let up_oid = up
        .get()
        .target()
        .ok_or(GitError::empty("upstream 无 target"))?;
    let (ahead, behind) = repo.graph_ahead_behind(local_oid, up_oid)?;
    Ok(AheadBehind {
        ahead: ahead as i32,
        behind: behind as i32,
        upstream: up.name()?.map(str::to_string),
    })
}

/// 返回数据值(String),不返回 Reference —— Reference 借用自 repo 且不可 Clone。
fn upstream_name(repo: &Repository, branch: &str) -> Option<String> {
    repo.find_branch(branch, git2::BranchType::Local)
        .ok()
        .and_then(|b| b.upstream().ok())
        .and_then(|u| u.name().ok().flatten().map(str::to_string))
}

/// 复合 status → (展示字符, index 侧有变更, 工作区侧有变更)。
/// 优先级:冲突 C > 工作区 > index(展示字符);staged/wt 独立成布尔双轨。
fn fold_status(st: Status) -> (String, bool, bool) {
    if st.is_conflicted() {
        return ("C".to_string(), false, true);
    }
    let wt = if st.is_wt_new() {
        Some("?")
    } else if st.is_wt_modified() {
        Some("M")
    } else if st.is_wt_deleted() {
        Some("D")
    } else if st.is_wt_renamed() {
        Some("R")
    } else if st.is_wt_typechange() {
        Some("T")
    } else {
        None
    };
    let idx = if st.is_index_new() {
        Some("A")
    } else if st.is_index_modified() {
        Some("M")
    } else if st.is_index_deleted() {
        Some("D")
    } else if st.is_index_renamed() {
        Some("R")
    } else if st.is_index_typechange() {
        Some("T")
    } else {
        None
    };
    let ch = wt.or(idx).unwrap_or("?");
    (ch.to_string(), idx.is_some(), wt.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fold_prefers_worktree_char() {
        // staged 后工作区又改 → 展示 M,staged=true,wt=true
        let st = Status::INDEX_NEW | Status::WT_MODIFIED;
        assert_eq!(fold_status(st), ("M".to_string(), true, true));
        // 纯 untracked
        assert_eq!(fold_status(Status::WT_NEW), ("?".to_string(), false, true));
        // 纯 staged 新增
        assert_eq!(
            fold_status(Status::INDEX_NEW),
            ("A".to_string(), true, false)
        );
        // 冲突态
        assert_eq!(
            fold_status(Status::CONFLICTED),
            ("C".to_string(), false, true)
        );
    }
}
