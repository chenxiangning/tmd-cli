//! log —— revwalk 分页提交摘要 + 每提交 ref 装饰(分支/远端/tag/HEAD)。

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
    /// 指向本提交的 ref 展示名:`HEAD -> main` / `main` / `origin/main` / `tag: v1`。
    /// 排序:HEAD 与本地分支在前,远端次之,tag 最后(注入顺序保证,见 ref_map)。
    pub refs: Vec<String>,
}

/// oid → ref 展示名列表。每次 walk 建一次全量映射,分页各页共享同一次遍历。
/// 只认 branches / remotes / tags,其余 refs(stash/notes 等)不装饰。
fn ref_map(
    repo: &Repository,
) -> Result<std::collections::HashMap<git2::Oid, Vec<String>>, GitError> {
    use std::collections::HashMap;
    let mut map: HashMap<git2::Oid, Vec<String>> = HashMap::new();
    let mut locals: Vec<(git2::Oid, String)> = Vec::new();
    let mut remotes: Vec<(git2::Oid, String)> = Vec::new();
    let mut tags: Vec<(git2::Oid, String)> = Vec::new();
    for r in repo.references()? {
        let r = r?;
        if r.is_tag() {
            // 附注 tag 的 target 是 tag 对象 oid,须 peel 到提交才能与 revwalk 对上;
            // 轻量 tag peel 也安全(直返指向的提交)
            let Ok(commit) = r.peel_to_commit() else {
                continue;
            };
            let Some(name) = r.shorthand() else { continue };
            tags.push((commit.id(), format!("tag: {name}")));
        } else if r.is_remote() {
            if let (Some(oid), Some(name)) = (r.target(), r.shorthand()) {
                remotes.push((oid, name.to_string()));
            }
        } else if r.is_branch() {
            if let (Some(oid), Some(name)) = (r.target(), r.shorthand()) {
                locals.push((oid, name.to_string()));
            }
        }
    }
    // 注入顺序 = 展示顺序:本地 → 远端 → tag
    for (oid, name) in locals.into_iter().chain(remotes).chain(tags) {
        map.entry(oid).or_default().push(name);
    }
    // HEAD 装饰:指向某本地分支时,该提交 refs 头部插 `HEAD -> <分支>`
    if let Ok(head) = repo.head() {
        if head.is_branch() {
            if let (Some(oid), Some(branch)) = (head.target(), head.shorthand()) {
                if let Some(list) = map.get_mut(&oid) {
                    list.insert(0, format!("HEAD -> {branch}"));
                }
            }
        }
    }
    Ok(map)
}

pub fn walk(repo: &Repository, limit: usize, offset: usize) -> Result<Vec<LogEntry>, GitError> {
    let refs = ref_map(repo)?;
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
            refs: refs.get(&oid).cloned().unwrap_or_default(),
        });
    }
    Ok(out)
}
