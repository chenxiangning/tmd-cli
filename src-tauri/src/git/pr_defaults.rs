//! 创建 PR defaults —— upstream/origin 解析与表单模板兜底。
//!
//! mossx get_git_pr_workflow_defaults 同口径复刻(设计 spec 2026-09-15):
//! upstream 缺省回落 origin;owner 从 origin 优先;标题取 HEAD commit summary;
//! 描述/评论用中文模板。类型对齐 kernel/gitContract.ts GitPrDefaults。

use git2::Repository;

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

/// 远端 URL → "owner/repo"(https / ssh / git@ 三形态;.git 后缀可选)。
/// host 必须精确等于 github.com:子串匹配会把 notgithub.com / github.company.com
/// 误归一成 GitHub 仓,拿用户 gh 登录态对错误仓发起操作(2026-09-15 评审)。
pub fn parse_github_repo(url: &str) -> Option<String> {
    let s = url.trim().trim_end_matches('/');
    /* 剥 scheme 后按首个 / 切 authority/path;scp 形态 git@host:path 单独认。 */
    let (host, path) = if let Some(rest) = s
        .strip_prefix("https://")
        .or_else(|| s.strip_prefix("http://"))
        .or_else(|| s.strip_prefix("ssh://"))
        .or_else(|| s.strip_prefix("git://"))
    {
        let (h, p) = rest.split_once('/')?;
        (h.rsplit('@').next().unwrap_or(h), p)
    } else if let Some(rest) = s.strip_prefix("git@") {
        let (h, p) = rest.split_once(':')?;
        (h, p)
    } else {
        return None;
    };
    if host != "github.com" {
        return None;
    }
    let path = path.strip_suffix(".git").unwrap_or(path);
    let mut segs = path.split('/').filter(|p| !p.is_empty());
    let owner = segs.next()?;
    let repo = segs.next()?;
    Some(format!("{owner}/{repo}"))
}

pub(super) fn remote_repo(repo: &Repository, name: &str) -> Option<String> {
    let url = repo.find_remote(name).ok()?.url()?.to_string();
    parse_github_repo(&url)
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
    /* find_branch(Remote) 找的是 refs/remotes/<名> 字面量,须按远端逐个探
     * refs/remotes/<remote>/{main,master}(2026-09-15 复查修正)。 */
    let remotes = repo.remotes().ok()?;
    let mut i = 0;
    while let Some(r) = remotes.get(i) {
        for b in ["main", "master"] {
            if repo
                .find_reference(&format!("refs/remotes/{r}/{b}"))
                .is_ok()
            {
                return Some(b.to_string());
            }
        }
        i += 1;
    }
    None
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

    #[test]
    fn github_repo_parsed_from_url_forms() {
        assert_eq!(
            parse_github_repo("https://github.com/zhukunpenglinyutong/desktop-cc-gui.git"),
            Some("zhukunpenglinyutong/desktop-cc-gui".into())
        );
        assert_eq!(
            parse_github_repo("git@github.com:chenxiangning/tmd-cli.git"),
            Some("chenxiangning/tmd-cli".into())
        );
        assert_eq!(
            parse_github_repo("ssh://git@github.com/o/r"),
            Some("o/r".into())
        );
        assert_eq!(parse_github_repo("https://gitlab.com/o/r"), None);
        /* host 精确匹配:伪 github 宿主不误归一(2026-09-15 评审) */
        assert_eq!(parse_github_repo("https://notgithub.com/o/r"), None);
        assert_eq!(parse_github_repo("https://github.company.com/x/y"), None);
        assert_eq!(parse_github_repo("git@notgithub.com:o/r"), None);
    }
}
