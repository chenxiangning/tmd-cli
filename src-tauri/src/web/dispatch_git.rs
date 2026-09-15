//! dispatch 分流:git 状态/提交域。
use std::future::Future;

use serde_json::Value;
use tauri::AppHandle;

use super::dispatch::{args, ser};
use super::dispatch_git_branch;

pub(super) async fn try_dispatch(
    app: &AppHandle,
    cmd: &str,
    raw: &Value,
) -> Option<Result<Value, String>> {
    if let Some(r) = dispatch_git_branch::try_dispatch(app, cmd, raw).await {
        return Some(r);
    }
    Some(match cmd {
        "git_repos_scan" => repos_scan(raw).await,
        "git_status" => cwd(raw, crate::git::commands::git_status).await,
        "git_totals" => cwd(raw, crate::git::commands::git_totals).await,
        "git_ahead_behind" => cwd(raw, crate::git::commands::git_ahead_behind).await,
        "git_branches" => cwd(raw, crate::git::commands::git_branches).await,
        "git_remotes" => cwd(raw, crate::git::commands::git_remotes).await,
        "git_pr_defaults" => cwd(raw, crate::git::commands_pr::git_pr_defaults).await,
        "git_diff_file_patch" => diff_patch(raw).await,
        "git_stage" => paths(raw, crate::git::commands::git_stage).await,
        "git_unstage" => paths(raw, crate::git::commands::git_unstage).await,
        "git_discard" => paths(raw, crate::git::commands::git_discard).await,
        "git_clean" => paths(raw, crate::git::commands::git_clean).await,
        "git_commit" => commit(raw).await,
        "git_log" => log(raw).await,
        "git_commit_files" => sha(raw, crate::git::commands::git_commit_files).await,
        "git_commit_message" => sha(raw, crate::git::commands::git_commit_message).await,
        "git_commit_file_patch" => commit_patch(raw).await,
        _ => return None,
    })
}

async fn cwd<T, F, Fut>(raw: &Value, f: F) -> Result<Value, String>
where
    F: FnOnce(String) -> Fut,
    Fut: Future<Output = Result<T, String>>,
    T: serde::Serialize,
{
    ser(f(args::<GitCwd>(raw)?.cwd).await)
}

async fn paths<T, F, Fut>(raw: &Value, f: F) -> Result<Value, String>
where
    F: FnOnce(String, Vec<String>) -> Fut,
    Fut: Future<Output = Result<T, String>>,
    T: serde::Serialize,
{
    let a = args::<GitPaths>(raw)?;
    ser(f(a.cwd, a.paths).await)
}

async fn sha<T, F, Fut>(raw: &Value, f: F) -> Result<Value, String>
where
    F: FnOnce(String, String) -> Fut,
    Fut: Future<Output = Result<T, String>>,
    T: serde::Serialize,
{
    let a = args::<GitSha>(raw)?;
    ser(f(a.cwd, a.sha).await)
}

async fn repos_scan(raw: &Value) -> Result<Value, String> {
    let a = args::<ReposScan>(raw)?;
    ser(crate::git::commands::git_repos_scan(a.root, a.max_depth).await)
}

async fn diff_patch(raw: &Value) -> Result<Value, String> {
    let a = args::<DiffPatch>(raw)?;
    ser(crate::git::commands::git_diff_file_patch(a.cwd, a.path, a.staged, a.full).await)
}

async fn commit(raw: &Value) -> Result<Value, String> {
    let a = args::<Commit>(raw)?;
    ser(crate::git::commands::git_commit(a.cwd, a.paths, a.input).await)
}

async fn log(raw: &Value) -> Result<Value, String> {
    let a = args::<Log>(raw)?;
    ser(crate::git::commands::git_log(a.cwd, a.limit, a.offset).await)
}

async fn commit_patch(raw: &Value) -> Result<Value, String> {
    let a = args::<CommitPatch>(raw)?;
    ser(crate::git::commands::git_commit_file_patch(a.cwd, a.sha, a.path, a.full).await)
}

#[derive(serde::Deserialize)]
struct GitCwd {
    cwd: String,
}

#[derive(serde::Deserialize)]
struct GitPaths {
    cwd: String,
    paths: Vec<String>,
}

#[derive(serde::Deserialize)]
struct GitSha {
    cwd: String,
    sha: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReposScan {
    root: String,
    max_depth: u32,
}

#[derive(serde::Deserialize)]
struct DiffPatch {
    cwd: String,
    path: String,
    staged: bool,
    full: bool,
}

#[derive(serde::Deserialize)]
struct Commit {
    cwd: String,
    paths: Vec<String>,
    input: crate::git::commit::CommitInput,
}

#[derive(serde::Deserialize)]
struct Log {
    cwd: String,
    limit: usize,
    offset: usize,
}

#[derive(serde::Deserialize)]
struct CommitPatch {
    cwd: String,
    sha: String,
    path: String,
    full: bool,
}
