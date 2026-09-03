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
    let parents: Vec<Commit> = match (&input.amend, &head_commit) {
        (true, Some(hc)) => hc.parents().collect(),
        (true, None) => return Err(GitError::empty("无提交可 amend")),
        (false, Some(hc)) => vec![hc.clone()],
        (false, None) => vec![],
    };
    let parents_ref: Vec<&Commit> = parents.iter().collect();
    let tree = repo.find_tree(tree_oid)?;
    if input.amend {
        let hc = head_commit.as_ref().unwrap();
        // amend: 新 commit 首父 ≠ 当前 tip,libgit2 拒绝经 "HEAD" 直写;
        // 先建对象(保留原 author,更新 committer),再手动把分支 ref 指过去。
        let author = hc.author();
        let oid = repo.commit(
            None,
            &author,
            &sig,
            input.message.trim(),
            &tree,
            &parents_ref,
        )?;
        // HEAD symbolic 时指向分支 ref,amend 需移动分支而非 HEAD;detached 时 HEAD 本身是直接 ref。
        let mut head_ref = repo.head()?;
        let msg = format!("commit (amend): {}", input.message.trim());
        if let Some(branch_name) = head_ref.symbolic_target() {
            repo.find_reference(branch_name)?.set_target(oid, &msg)?;
        } else {
            head_ref.set_target(oid, &msg)?;
        }
        return Ok(oid.to_string());
    }
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

#[cfg(test)]
mod amend_verify {
    use super::*;
    use crate::git::{tests_common::TempRepo, with_repo};

    #[test]
    fn amend_replaces_head() {
        let t = TempRepo::new();
        with_repo(t.path(), |repo| {
            commit(repo, vec![], CommitInput { message: "init".into(), amend: false })?;
            std::fs::write(std::path::Path::new(t.path()).join("f.txt"), "data").unwrap();
            commit(repo, vec!["f.txt".into()], CommitInput { message: "second".into(), amend: false })?;
            let before_author = repo.head()?.peel_to_commit()?.author().name().unwrap().to_string();
            let sha = commit(repo, vec![], CommitInput { message: "amended".into(), amend: true })?;
            let head = repo.head()?.peel_to_commit()?;
            assert_eq!(head.id().to_string(), sha);
            assert_eq!(head.summary(), Some("amended"));
            assert_eq!(head.parent_count(), 1);
            assert_eq!(head.parent(0)?.summary(), Some("init"));
            assert_eq!(head.author().name(), Some(before_author.as_str()));
            Ok(())
        })
        .unwrap();
    }
}
