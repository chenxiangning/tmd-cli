//! blame —— 逐行归属(行 → 最后改动提交)。
//!
//! 每行携带行文本 + 提交元数据;boundary = 与上一行不同提交(前端分组描边)。
//! 工作区文件不在 HEAD(未跟踪新文件)时 git2 报错,原样上抛由前端兜底展示。

use std::path::Path;

use git2::Repository;
use serde::Serialize;

use super::GitError;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    /// 1 基行号
    pub line_no: u32,
    pub text: String,
    pub short_sha: String,
    /// commit message 首行
    pub summary: String,
    pub author_name: String,
    /// unix 秒
    pub author_when: i64,
    /// 与上一行非同一提交(分组描边用)
    pub boundary: bool,
}

pub fn blame(repo: &Repository, path: &str) -> Result<Vec<BlameLine>, GitError> {
    let mut opts = git2::BlameOptions::new();
    opts.track_copies_any_commit_copies(true);
    let blame = repo.blame_file(Path::new(path), Some(&mut opts))?;

    let workdir = repo
        .workdir()
        .ok_or_else(|| GitError::empty("bare 仓库无工作区文件"))?;
    let content = std::fs::read_to_string(workdir.join(path))?;

    let mut out = Vec::new();
    let mut prev_oid: Option<git2::Oid> = None;
    for (i, text) in content.lines().enumerate() {
        let line_no = i as u32 + 1;
        let Some(hunk) = blame.get_line(usize::try_from(line_no).unwrap_or(usize::MAX)) else {
            continue;
        };
        let oid = hunk.final_commit_id();
        let commit = repo.find_commit(oid)?;
        let boundary = prev_oid != Some(oid);
        prev_oid = Some(oid);
        out.push(BlameLine {
            line_no,
            text: text.to_string(),
            short_sha: oid.to_string().chars().take(7).collect(),
            summary: commit.summary().unwrap_or_default().to_string(),
            author_name: hunk
                .final_signature()
                .name()
                .unwrap_or_default()
                .to_string(),
            author_when: hunk.final_signature().when().seconds(),
            boundary,
        });
    }
    Ok(out)
}
