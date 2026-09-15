//! dispatch 分流:git 分支/远程/PR 域。
use std::future::Future;

use serde_json::Value;
use tauri::AppHandle;

use super::dispatch::{args, ser};

pub(super) async fn try_dispatch(
    app: &AppHandle,
    cmd: &str,
    raw: &Value,
) -> Option<Result<Value, String>> {
    Some(match cmd {
        "git_checkout" => name(raw, crate::git::commands::git_checkout).await,
        "git_checkout_remote" => name(raw, crate::git::commands::git_checkout_remote).await,
        "git_merge_branch" => name(raw, crate::git::commands::git_merge_branch).await,
        "git_create_branch" => create_branch(raw).await,
        "git_delete_branch" => delete_branch(raw).await,
        "git_rebase_branch" => rebase(raw).await,
        "git_rename_branch" => rename_branch(raw).await,
        "git_branch_compare" => branch_compare(raw).await,
        "git_branch_worktree_files" => worktree_files(raw).await,
        "git_branch_worktree_patch" => worktree_patch(raw).await,
        "git_pull_push" => pull_push(raw).await,
        "git_push_preview" => push_preview(raw).await,
        "git_remote_request" => remote_request(raw).await,
        "git_pr_run" => pr_run(app, raw).await,
        "git_smart_checkout" => smart_checkout(raw).await,
        "git_smart_checkout_undo" => smart_undo(raw).await,
        _ => return None,
    })
}

async fn name<T, F, Fut>(raw: &Value, f: F) -> Result<Value, String>
where
    F: FnOnce(String, String) -> Fut,
    Fut: Future<Output = Result<T, String>>,
    T: serde::Serialize,
{
    let a = args::<GitName>(raw)?;
    ser(f(a.cwd, a.name).await)
}

async fn create_branch(raw: &Value) -> Result<Value, String> {
    let a = args::<CreateBranch>(raw)?;
    ser(crate::git::commands::git_create_branch(a.cwd, a.name, a.from).await)
}

async fn delete_branch(raw: &Value) -> Result<Value, String> {
    let a = args::<DeleteBranch>(raw)?;
    ser(crate::git::commands::git_delete_branch(a.cwd, a.name, a.force).await)
}

async fn rebase(raw: &Value) -> Result<Value, String> {
    let a = args::<Rebase>(raw)?;
    ser(crate::git::commands::git_rebase_branch(a.cwd, a.onto).await)
}

async fn rename_branch(raw: &Value) -> Result<Value, String> {
    let a = args::<RenameBranch>(raw)?;
    ser(crate::git::commands::git_rename_branch(a.cwd, a.old_name, a.new_name).await)
}

async fn branch_compare(raw: &Value) -> Result<Value, String> {
    let a = args::<BranchCompare>(raw)?;
    ser(crate::git::commands::git_branch_compare(a.cwd, a.target, a.current, a.limit).await)
}

async fn worktree_files(raw: &Value) -> Result<Value, String> {
    let a = args::<WorktreeBranch>(raw)?;
    ser(crate::git::commands::git_branch_worktree_files(a.cwd, a.branch).await)
}

async fn worktree_patch(raw: &Value) -> Result<Value, String> {
    let a = args::<WorktreePatch>(raw)?;
    ser(crate::git::commands::git_branch_worktree_patch(a.cwd, a.branch, a.path).await)
}

async fn pull_push(raw: &Value) -> Result<Value, String> {
    let a = args::<PullPush>(raw)?;
    ser(crate::git::commands::git_pull_push(a.cwd, a.op, a.branch).await)
}

async fn push_preview(raw: &Value) -> Result<Value, String> {
    let a = args::<PushPreview>(raw)?;
    ser(crate::git::commands::git_push_preview(a.cwd, a.remote, a.branch, a.limit).await)
}

async fn remote_request(raw: &Value) -> Result<Value, String> {
    let a = args::<RemoteReq>(raw)?;
    ser(crate::git::commands::git_remote_request(a.cwd, a.req).await)
}

async fn pr_run(app: &AppHandle, raw: &Value) -> Result<Value, String> {
    let a = args::<PrRun>(raw)?;
    ser(crate::git::commands_pr::git_pr_run(a.cwd, a.req, app.clone()).await)
}

async fn smart_checkout(raw: &Value) -> Result<Value, String> {
    let a = args::<SmartCheckout>(raw)?;
    ser(crate::git::commands::git_smart_checkout(a.cwd, a.name, a.remote).await)
}

async fn smart_undo(raw: &Value) -> Result<Value, String> {
    let a = args::<SmartUndo>(raw)?;
    ser(crate::git::commands::git_smart_checkout_undo(a.cwd, a.original).await)
}

#[derive(serde::Deserialize)]
struct GitName {
    cwd: String,
    name: String,
}

#[derive(serde::Deserialize)]
struct CreateBranch {
    cwd: String,
    name: String,
    from: Option<String>,
}

#[derive(serde::Deserialize)]
struct DeleteBranch {
    cwd: String,
    name: String,
    force: bool,
}

#[derive(serde::Deserialize)]
struct Rebase {
    cwd: String,
    onto: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameBranch {
    cwd: String,
    old_name: String,
    new_name: String,
}

#[derive(serde::Deserialize)]
struct BranchCompare {
    cwd: String,
    target: String,
    current: String,
    limit: Option<usize>,
}

#[derive(serde::Deserialize)]
struct WorktreeBranch {
    cwd: String,
    branch: String,
}

#[derive(serde::Deserialize)]
struct WorktreePatch {
    cwd: String,
    branch: String,
    path: String,
}

#[derive(serde::Deserialize)]
struct PullPush {
    cwd: String,
    op: String,
    branch: Option<String>,
}

#[derive(serde::Deserialize)]
struct PushPreview {
    cwd: String,
    remote: String,
    branch: String,
    limit: Option<usize>,
}

#[derive(serde::Deserialize)]
struct RemoteReq {
    cwd: String,
    req: crate::git::remote_request::RemoteRequest,
}

#[derive(serde::Deserialize)]
struct PrRun {
    cwd: String,
    req: crate::git::pr_workflow::PrRequest,
}

#[derive(serde::Deserialize)]
struct SmartCheckout {
    cwd: String,
    name: String,
    remote: bool,
}

#[derive(serde::Deserialize)]
struct SmartUndo {
    cwd: String,
    original: String,
}
