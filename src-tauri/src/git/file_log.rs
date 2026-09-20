//! file_log —— 按路径过滤的提交历史(文件维度,新→旧)。
//!
//! 判定:提交树中该路径 blob oid 与首父不同(新增 = 首父缺,删除 = 本提交缺)。
//! 合并提交只比对首父(与 GitHub 文件历史口径一致);上限 limit 防大仓全量扫描。

use std::path::Path;

use git2::{Repository, Sort};
use serde::Serialize;

use super::GitError;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileLogEntry {
    /// 短 sha(7 位)
    pub short_sha: String,
    pub long_sha: String,
    /// commit message 首行
    pub summary: String,
    pub author_name: String,
    /// unix 秒
    pub author_when: i64,
}

/// 提交树中该路径的 blob oid;路径缺失或非 blob = None。
fn blob_oid(tree: &git2::Tree, path: &str) -> Option<git2::Oid> {
    tree.get_path(Path::new(path))
        .ok()
        .filter(|e| e.kind() == Some(git2::ObjectType::Blob))
        .map(|e| e.id())
}

pub fn walk_file(
    repo: &Repository,
    path: &str,
    limit: usize,
) -> Result<Vec<FileLogEntry>, GitError> {
    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(Sort::TIME)?;

    let mut out = Vec::new();
    for oid in revwalk {
        let oid = oid?;
        let commit = repo.find_commit(oid)?;
        let now = blob_oid(&commit.tree()?, path);
        let prev = commit
            .parent(0)
            .ok()
            .and_then(|p| p.tree().ok())
            .and_then(|t| blob_oid(&t, path));
        if now == prev {
            continue;
        }
        out.push(FileLogEntry {
            short_sha: oid.to_string().chars().take(7).collect(),
            long_sha: oid.to_string(),
            summary: commit.summary().unwrap_or_default().to_string(),
            author_name: commit.author().name().unwrap_or_default().to_string(),
            author_when: commit.author().when().seconds(),
        });
        if out.len() >= limit {
            break;
        }
    }
    Ok(out)
}
