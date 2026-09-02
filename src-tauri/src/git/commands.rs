//! Tauri command 层 —— 14 个命令,cwd 字符串为唯一维度。
//!
//! 全部 async + spawn_blocking(libgit2/子进程皆阻塞;同步 command 会跑在
//! Tauri 主线程冻结 UI —— 本仓 cli_probe/cli_install 同款约定)。
//! 写操作成功后 evict_cwd(后端自治,不暴露 invalidate IPC)。

use git2::Repository;

use super::{
    ahead_behind as ahead_behind_impl, branch_ops, commit as commit_impl, diff, index_ops,
    remote_ops, status as status_impl, walk_log, with_repo, AheadBehind, BranchList, CommitInput,
    DiffStatus, DiffTotals, FilePatch, GitError, LogEntry,
};

/// 读命令模板:spawn_blocking 包 with_repo;JoinError 只在 panic/取消时出现。
async fn run<T, F>(cwd: String, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&Repository) -> Result<T, GitError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || with_repo(&cwd, f))
        .await
        .map_err(|e| format!("E_GIT2: 任务调度失败: {e}"))?
        .map_err(Into::into)
}

/// 写命令模板:成功后 evict 缓存。
async fn run_mut<T, F>(cwd: String, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&Repository) -> Result<T, GitError> + Send + 'static,
{
    let key = cwd.clone();
    let out = run(cwd, f).await?;
    super::evict_cwd(&key);
    Ok(out)
}

#[tauri::command]
pub async fn git_status(cwd: String) -> Result<DiffStatus, String> {
    run(cwd, status_impl::compute).await
}

#[tauri::command]
pub async fn git_ahead_behind(cwd: String) -> Result<AheadBehind, String> {
    run(cwd, ahead_behind_impl).await
}

#[tauri::command]
pub async fn git_diff_file_patch(
    cwd: String,
    path: String,
    staged: bool,
) -> Result<Option<FilePatch>, String> {
    run(cwd, move |r| diff::file_patch(r, &path, staged)).await
}

/// 聚合 ±行数 —— 独立低频命令:写操作后/手动刷新时拉,
/// 不挂 5s 轮询(全仓 diff×2 + 全量读文件计行,锁内耗时随脏文件数线性放大)。
#[tauri::command]
pub async fn git_totals(cwd: String) -> Result<DiffTotals, String> {
    run(cwd, diff::totals_of).await
}
#[tauri::command]
pub async fn git_stage(cwd: String, paths: Vec<String>) -> Result<(), String> {
    run_mut(cwd, move |r| index_ops::stage(r, paths)).await
}

#[tauri::command]
pub async fn git_unstage(cwd: String, paths: Vec<String>) -> Result<(), String> {
    run_mut(cwd, move |r| index_ops::unstage(r, paths)).await
}

#[tauri::command]
pub async fn git_discard(cwd: String, paths: Vec<String>) -> Result<(), String> {
    run_mut(cwd, move |r| index_ops::discard(r, paths)).await
}

#[tauri::command]
pub async fn git_commit(
    cwd: String,
    paths: Vec<String>,
    input: CommitInput,
) -> Result<String, String> {
    run_mut(cwd, move |r| commit_impl::commit(r, paths, input)).await
}

#[tauri::command]
pub async fn git_log(cwd: String, limit: usize, offset: usize) -> Result<Vec<LogEntry>, String> {
    run(cwd, move |r| walk_log(r, limit, offset)).await
}

#[tauri::command]
pub async fn git_branches(cwd: String) -> Result<BranchList, String> {
    run(cwd, branch_ops::list_all).await
}

#[tauri::command]
pub async fn git_checkout(cwd: String, name: String) -> Result<(), String> {
    run_mut(cwd, move |r| branch_ops::checkout(r, &name)).await
}

#[tauri::command]
pub async fn git_create_branch(
    cwd: String,
    name: String,
    from: Option<String>,
) -> Result<(), String> {
    run_mut(cwd, move |r| branch_ops::create(r, &name, from)).await
}

#[tauri::command]
pub async fn git_delete_branch(cwd: String, name: String, force: bool) -> Result<(), String> {
    run_mut(cwd, move |r| branch_ops::delete(r, &name, force)).await
}

#[tauri::command]
pub async fn git_fetch(cwd: String) -> Result<String, String> {
    // 经 with_repo 持内层锁:与轮询 status 互斥,消 torn-state 窗口
    let cwd2 = cwd.clone();
    run(cwd, move |r| {
        remote_ops::run(r, &cwd2, remote_ops::RemoteOp::Fetch, None)
    })
    .await
}

#[tauri::command]
pub async fn git_pull_push(
    cwd: String,
    op: String,
    branch: Option<String>,
) -> Result<String, String> {
    let op = match op.as_str() {
        "pull" => remote_ops::RemoteOp::Pull,
        "push" => remote_ops::RemoteOp::Push,
        other => return Err(format!("E_EMPTY: 未知远端操作: {other}")),
    };
    // pull 会移动 HEAD → 写路径,成功 evict
    let cwd2 = cwd.clone();
    run_mut(cwd, move |r| remote_ops::run(r, &cwd2, op, branch)).await
}
