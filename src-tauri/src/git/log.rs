//! log —— revwalk 分页提交摘要。

use git2::Repository;
use serde::Serialize;

use super::GitError;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    /// 短 sha(7 位)
    pub short_sha: String,
    pub long_sha: String,
    /// commit message 首行
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    /// unix 秒
    pub author_when: i64,
    pub parent_shas: Vec<String>,
}

pub fn walk(repo: &Repository, limit: usize, offset: usize) -> Result<Vec<LogEntry>, GitError> {
    let mut revwalk = repo.revwalk()?;
    if let Err(e) = revwalk.push_head() {
        // 实测(git2 0.20):unborn 时 push_head 报 GenericError("reference not found"),
        // head() 报 UnbornBranch —— 可靠判据以 head() 为准,不测 push 的错误码
        if repo.head().is_err() {
            return Ok(vec![]);
        }
        return Err(e.into());
    }
    // TIME|TOPOLOGICAL:同秒提交按拓扑给稳定序,offset 分页不漂(纯 TIME 平手不稳)
    revwalk.set_sorting(git2::Sort::TIME | git2::Sort::TOPOLOGICAL)?;

    let mut out = Vec::with_capacity(limit.min(256));
    for oid in revwalk.skip(offset).take(limit) {
        let oid = oid?;
        let commit = repo.find_commit(oid)?;
        let long = oid.to_string();
        let short = long[..7.min(long.len())].to_string();
        out.push(LogEntry {
            short_sha: short,
            long_sha: long,
            summary: commit.summary().unwrap_or("").to_string(),
            author_name: commit.author().name().unwrap_or("").to_string(),
            author_email: commit.author().email().unwrap_or("").to_string(),
            author_when: commit.author().when().seconds(),
            parent_shas: commit.parent_ids().map(|o| o.to_string()).collect(),
        });
    }
    Ok(out)
}
