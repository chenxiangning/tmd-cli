//! 远端对话框请求层 —— 自 remote_ops.rs 拆出(文件规模铁则)。
//! op 分派与结构化选项拼装(字段 camelCase 对齐 kernel/ipc 契约),执行经 remote_ops::exec_git。

use serde::Deserialize;

use git2::{BranchType, Repository};

use super::remote_args::{first_remote, upstream_split};
use super::remote_ops::{exec_git, non_empty_branch};
use super::GitError;

/* ── 远端对话框请求(op 分派;字段 camelCase 对齐 kernel/ipc 契约)── */

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRequest {
    /// "fetch" | "pull" | "push"
    pub op: String,
    pub remote: Option<String>,
    pub branch: Option<String>,
    /// pull:--rebase / --ff-only / --no-ff / --squash(单选,可空)
    pub strategy: Option<String>,
    #[serde(default)]
    pub no_commit: bool,
    #[serde(default)]
    pub no_verify: bool,
    #[serde(default)]
    pub force_with_lease: bool,
    #[serde(default)]
    pub follow_tags: bool,
    /// push:Gerrit 模式(refspec 改 HEAD:refs/for/<branch>[%suffix])
    pub gerrit: Option<GerritExtra>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GerritExtra {
    pub topic: Option<String>,
    /// 逗号分隔用户名
    pub reviewers: Option<String>,
    /// 逗号分隔用户名
    pub cc: Option<String>,
}

const PULL_STRATEGIES: [&str; 4] = ["--rebase", "--ff-only", "--no-ff", "--squash"];

pub fn run_request(repo: &Repository, cwd: &str, req: RemoteRequest) -> Result<String, GitError> {
    let args = match req.op.as_str() {
        "fetch" => fetch_request_args(req.remote)?,
        "pull" => pull_request_args(&req)?,
        "push" => push_request_args(repo, &req)?,
        other => return Err(GitError::empty(format!("未知远端操作: {other}"))),
    };
    exec_git(repo, cwd, &args)
}

/// fetch:remote 空 = 全部远端(保留 --prune,清理已删远端分支的引用);
/// 非空 = 只 fetch 该远端。
pub(super) fn fetch_request_args(remote: Option<String>) -> Result<Vec<String>, GitError> {
    Ok(match non_empty_branch(&remote)? {
        Some(r) => vec!["fetch".into(), r],
        None => vec!["fetch".into(), "--all".into(), "--prune".into()],
    })
}

/// pull 拼装序:`pull [strategy] [--no-commit] [--no-verify] [remote [branch]]`。
pub(super) fn pull_request_args(req: &RemoteRequest) -> Result<Vec<String>, GitError> {
    let mut args = vec!["pull".to_string()];
    if let Some(s) = req
        .strategy
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if !PULL_STRATEGIES.contains(&s) {
            return Err(GitError::empty(format!("不支持的 pull 策略: {s}")));
        }
        args.push(s.into());
    }
    if req.no_commit {
        args.push("--no-commit".into());
    }
    if req.no_verify {
        args.push("--no-verify".into());
    }
    if let Some(r) = non_empty_branch(&req.remote)? {
        args.push(r);
    }
    if let Some(b) = non_empty_branch(&req.branch)? {
        args.push(b);
    }
    Ok(args)
}

/// push 拼装序:`push [--no-verify] [--force-with-lease] [--follow-tags] [-u] <remote> <refspec>`。
/// refspec 常规 = `HEAD:<branch>`;Gerrit = `HEAD:refs/for/<branch>[%topic=…,r=…,cc=…]`。
/// 当前分支无 upstream 时补 `-u` 建跟踪(保持面板直推的既有语义)。
pub(super) fn push_request_args(
    repo: &Repository,
    req: &RemoteRequest,
) -> Result<Vec<String>, GitError> {
    let branch =
        non_empty_branch(&req.branch)?.ok_or_else(|| GitError::empty("推送目标分支不能为空"))?;
    let mut args = vec!["push".to_string()];
    if req.no_verify {
        args.push("--no-verify".into());
    }
    if req.force_with_lease {
        args.push("--force-with-lease".into());
    }
    if req.follow_tags {
        args.push("--follow-tags".into());
    }
    let remote = match non_empty_branch(&req.remote)? {
        Some(r) => r,
        // 未显式指定:上游远端 → 首个远端
        None => {
            let current = repo
                .head()
                .ok()
                .filter(|h| h.is_branch())
                .and_then(|h| h.shorthand().map(str::to_string));
            current
                .as_deref()
                .and_then(|c| upstream_split(repo, c).map(|(r, _)| r))
                .unwrap_or(first_remote(repo)?)
        }
    };
    args.push(remote);
    match &req.gerrit {
        Some(g) => {
            let mut refspec = format!("HEAD:refs/for/{branch}");
            let suffix = gerrit_suffix(g);
            if !suffix.is_empty() {
                refspec.push('%');
                refspec.push_str(&suffix);
            }
            args.push(refspec);
        }
        None => {
            let current = repo
                .head()
                .ok()
                .filter(|h| h.is_branch())
                .and_then(|h| h.shorthand().map(str::to_string));
            let tracked = current
                .as_deref()
                .and_then(|c| repo.find_branch(c, BranchType::Local).ok())
                .and_then(|b| b.upstream().ok());
            if tracked.is_none() {
                args.push("-u".into());
            }
            args.push(format!("HEAD:{branch}"));
        }
    }
    Ok(args)
}

/// Gerrit refspec 尾巴:`topic=<t>` 在前;reviewers/cc 逗号分隔展开为 `r=<v>` / `cc=<v>`。
pub(super) fn gerrit_suffix(g: &GerritExtra) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(t) = g.topic.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        parts.push(format!("topic={t}"));
    }
    for (raw, prefix) in [(&g.reviewers, "r="), (&g.cc, "cc=")] {
        for item in raw.as_deref().unwrap_or("").split(',') {
            let s = item.trim();
            if !s.is_empty() {
                parts.push(format!("{prefix}{s}"));
            }
        }
    }
    parts.join(",")
}
