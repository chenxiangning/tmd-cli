//! commit —— 勾选提交(paths 非空先 stage)+ 空提交防线 + signature fallback。
//!
//! 空提交检查:比较 head_commit.tree_id() 与新写 tree_oid(同为 tree OID 才有意义)。

use git2::{Commit, Repository, Signature};
use serde::Deserialize;

use super::{fresh_index, index_ops, GitError};

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommitInput {
    pub message: String,
    #[serde(default)]
    pub amend: bool,
}

/// 返回新 commit sha。paths 非空 = 布局契约的"勾选+提交一步完成"。
pub fn commit(
    repo: &Repository,
    paths: Vec<String>,
    input: CommitInput,
) -> Result<String, GitError> {
    if input.message.trim().is_empty() {
        return Err(GitError::empty("commit message 不能为空"));
    }
    if !paths.is_empty() {
        index_ops::stage(repo, paths)?;
    }

    let mut index = fresh_index(repo)?;
    let tree_oid = index.write_tree()?;

    let head_commit = match repo.head() {
        Ok(r) => Some(r.peel_to_commit()?),
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch => None, // 首个 commit
        Err(e) => return Err(e.into()),
    };

    if !input.amend {
        if let Some(hc) = &head_commit {
            if hc.tree_id() == tree_oid {
                return Err(GitError::empty("无变更需要提交"));
            }
        }
    }

    let sig = resolve_signature(repo)?;
    let parents: Vec<Commit> = match (input.amend, head_commit) {
        (true, Some(hc)) => hc.parents().collect(),
        (true, None) => return Err(GitError::empty("无提交可 amend")),
        (false, Some(hc)) => vec![hc],
        (false, None) => vec![],
    };
    let parents_ref: Vec<&Commit> = parents.iter().collect();
    let tree = repo.find_tree(tree_oid)?;
    let oid = repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        input.message.trim(),
        &tree,
        &parents_ref,
    )?;
    Ok(oid.to_string())
}

/// author = committer = git config user.* → 环境变量 → 兜底。
/// git config 本就同一组 user.name/user.email,不分 author/committer 两路。
fn resolve_signature(repo: &Repository) -> Result<Signature<'static>, GitError> {
    let cfg = repo.config()?;
    let name = cfg
        .get_string("user.name")
        .ok()
        .or_else(|| std::env::var("GIT_AUTHOR_NAME").ok())
        .unwrap_or_else(|| "tmd-cli".into());
    let email = cfg
        .get_string("user.email")
        .ok()
        .or_else(|| std::env::var("GIT_AUTHOR_EMAIL").ok())
        .unwrap_or_else(|| "tmd-cli@localhost".into());
    Ok(Signature::now(&name, &email)?)
}
