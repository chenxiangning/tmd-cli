//! 创建 PR defaults —— upstream/origin 解析与表单模板兜底。
//!
//! mossx get_git_pr_workflow_defaults 同口径复刻(设计 spec 2026-09-15):
//! upstream 缺省回落 origin;owner 从 origin 优先;标题取 HEAD commit summary;
//! 描述/评论用中文模板。类型对齐 kernel/gitContract.ts GitPrDefaults。

use git2::Repository;

use super::pr_gh;
use super::GitError;

/// 描述模板({base}/{head} 占位;四步编排的 gh pr create 兜底同用)。
pub(super) const PR_BODY_TEMPLATE: &str =
    "## 背景\n- 从 `{head}` 合并到 `{base}`。\n\n## 改动点\n- \n\n## 验证\n- [ ] pnpm typecheck\n- [ ] pnpm test";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrDefaults {
    pub upstream_repo: String,
    pub base_branch: String,
    pub head_owner: String,
    pub head_branch: String,
    pub title: String,
    pub body: String,
    pub comment_body: String,
    pub can_create: bool,
    pub disabled_reason: Option<String>,
}

pub(super) fn remote_repo(repo: &Repository, name: &str) -> Option<String> {
    let url = repo.find_remote(name).ok()?.url()?.to_string();
    pr_gh::parse_github_repo(&url)
}

/// base 分支推断:远端 HEAD → 跟踪分支兜底交由调用方 → origin HEAD → main/master。
fn infer_base_branch(repo: &Repository, remote: &str) -> Option<String> {
    let head_ref = repo
        .find_reference(&format!("refs/remotes/{remote}/HEAD"))
        .ok()?;
    head_ref
        .symbolic_target()?
        .strip_prefix(&format!("refs/remotes/{remote}/"))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn remote_default_branch(repo: &Repository) -> Option<String> {
    ["main", "master"]
        .iter()
        .find(|b| repo.find_branch(b, git2::BranchType::Remote).is_ok())
        .map(|b| b.to_string())
}

fn head_summary(repo: &Repository) -> Option<String> {
    let commit = repo.head().ok()?.peel_to_commit().ok()?;
    commit
        .summary()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn repo_owner(repo_name: &Option<String>) -> Option<String> {
    repo_name
        .as_deref()
        .and_then(|r| r.split('/').next())
        .filter(|o| !o.is_empty())
        .map(str::to_string)
}

/// defaults 自动填表(不可创建时带人话原因,前端禁用提交按钮)。
pub fn defaults(repo: &Repository) -> Result<PrDefaults, GitError> {
    let head_branch = repo
        .head()
        .ok()
        .filter(|h| h.is_branch())
        .and_then(|h| h.shorthand().map(str::to_string))
        .unwrap_or_default();
    let origin_repo = remote_repo(repo, "origin");
    let upstream_repo = remote_repo(repo, "upstream").or_else(|| origin_repo.clone());
    let base_branch = infer_base_branch(repo, "upstream")
        .or_else(|| infer_base_branch(repo, "origin"))
        .or_else(|| remote_default_branch(repo))
        .unwrap_or_else(|| "main".to_string());
    let head_owner = repo_owner(&origin_repo)
        .or_else(|| repo_owner(&upstream_repo))
        .unwrap_or_default();
    let title =
        head_summary(repo).unwrap_or_else(|| format!("chore(git): create pr for {head_branch}"));
    let disabled_reason = if head_branch.is_empty() {
        Some("当前分支不可用(detached HEAD),请先检出分支。".to_string())
    } else if upstream_repo.as_deref().unwrap_or_default().is_empty() {
        Some("未检测到 GitHub 远端,请先配置 origin 或 upstream。".to_string())
    } else if head_owner.is_empty() {
        Some("无法从远端 URL 解析 fork 属主(owner)。".to_string())
    } else {
        None
    };
    let comment_owner = repo_owner(&upstream_repo).unwrap_or_else(|| "maintainer".to_string());
    let body = PR_BODY_TEMPLATE
        .replace(
            "{base}",
            if base_branch.is_empty() {
                "main"
            } else {
                &base_branch
            },
        )
        .replace(
            "{head}",
            if head_branch.is_empty() {
                "HEAD"
            } else {
                &head_branch
            },
        );
    Ok(PrDefaults {
        upstream_repo: upstream_repo.unwrap_or_default(),
        base_branch,
        head_owner,
        head_branch,
        title,
        body,
        comment_body: format!("@{comment_owner} 麻烦审批,已完成验证。"),
        can_create: disabled_reason.is_none(),
        disabled_reason,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owner_extracted() {
        assert_eq!(
            repo_owner(&Some("chenxiangning/tmd-cli".into())),
            Some("chenxiangning".into())
        );
        assert_eq!(repo_owner(&None), None);
    }
}
