//! Tauri command 层 —— cwd 字符串为唯一维度。
//!
//! 全部 async + spawn_blocking(libgit2/子进程皆阻塞;同步 command 会跑在
//! Tauri 主线程冻结 UI —— 本仓 cli_probe/cli_install 同款约定)。
//! 写操作成功后 evict_cwd(后端自治,不暴露 invalidate IPC)。

use git2::Repository;

use super::{
    ahead_behind as ahead_behind_impl, branch_ops, commit as commit_impl, commit_view, compare_ops,
    diff, index_ops, remote_ops, repos_scan, stash_ops, status as status_impl, walk_log, with_repo,
    with_repo_mut, AheadBehind, BranchCompareSet, BranchDiffFile, BranchList, CommitFile,
    CommitInput, DiffStatus, DiffTotals, FilePatch, GitError, LogEntry, RepoScanResult,
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

/// 写命令模板:成功后 evict 缓存。递 &mut Repository —— stash 等写操作需要可变句柄;
/// 既有 &Repository 写实现经自动解引用强转兼容,调用点零改动。
async fn run_mut<T, F>(cwd: String, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut Repository) -> Result<T, GitError> + Send + 'static,
{
    let key = cwd.clone();
    let out = tauri::async_runtime::spawn_blocking(move || with_repo_mut(&cwd, f))
        .await
        .map_err(|e| format!("E_GIT2: 任务调度失败: {e}"))?
        .map_err(String::from)?;
    super::evict_cwd(&key);
    Ok(out)
}

#[tauri::command]
pub async fn git_status(cwd: String) -> Result<DiffStatus, String> {
    run(cwd, status_impl::compute).await
}

/// 多仓发现(workspace 根 BFS;不走 with_repo 缓存 —— 见 repos_scan.rs)。
#[tauri::command]
pub async fn git_repos_scan(root: String, max_depth: u32) -> Result<RepoScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || repos_scan::scan(&root, max_depth))
        .await
        .map_err(|e| format!("E_GIT2: 任务调度失败: {e}"))?
        .map_err(String::from)
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

/// 提交文件清单(历史 Graph 展开;sha 口径见 commit_view)。
#[tauri::command]
pub async fn git_commit_files(cwd: String, sha: String) -> Result<Vec<CommitFile>, String> {
    run(cwd, move |r| commit_view::files(r, &sha)).await
}

/// 提交内单文件 patch(path 按 新路径/rename 来源匹配)。
#[tauri::command]
pub async fn git_commit_file_patch(
    cwd: String,
    sha: String,
    path: String,
) -> Result<Option<FilePatch>, String> {
    run(cwd, move |r| commit_view::file_patch(r, &sha, &path)).await
}

/// 提交完整 message(分支对比详情面板)。
#[tauri::command]
pub async fn git_commit_message(cwd: String, sha: String) -> Result<String, String> {
    run(cwd, move |r| commit_view::message(r, &sha)).await
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
pub async fn git_checkout_remote(cwd: String, name: String) -> Result<(), String> {
    run_mut(cwd, move |r| branch_ops::checkout_remote(r, &name)).await
}

/// 「暂存并切换」(IDEA Smart Checkout 复刻):脏工作区 stash -u → 切换 → pop;
/// pop 冲突时切换已生效、stash 保留,错误文案引导。remote = 远程分支检出版。
#[tauri::command]
pub async fn git_smart_checkout(cwd: String, name: String, remote: bool) -> Result<(), String> {
    run_mut(cwd, move |r| stash_ops::smart_checkout(r, &name, remote)).await
}

/// 还原一次「暂存并切换」:丢弃切换后分支的冲突状态(reset --hard,内容在
/// stash 中不丢失),切回 original 分支并恢复改动。无 stash 时拒绝。
#[tauri::command]
pub async fn git_smart_checkout_undo(cwd: String, original: String) -> Result<(), String> {
    run_mut(cwd, move |r| stash_ops::undo(r, &original)).await
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

/// 合并分支到当前分支(CLI;冲突留 MERGE_HEAD 中间态,幕布终端可接管)。
#[tauri::command]
pub async fn git_merge_branch(cwd: String, name: String) -> Result<(), String> {
    let c = cwd.clone();
    run_mut(cwd, move |r| branch_ops::merge(r, &c, &name)).await
}

/// 当前分支变基到 onto(CLI;冲突留 rebase-merge 中间态)。
#[tauri::command]
pub async fn git_rebase_branch(cwd: String, onto: String) -> Result<(), String> {
    let c = cwd.clone();
    run_mut(cwd, move |r| branch_ops::rebase(r, &c, &onto)).await
}

/// 重命名本地分支(CLI `git branch -m`,upstream 配置随迁)。
#[tauri::command]
pub async fn git_rename_branch(
    cwd: String,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    let c = cwd.clone();
    run_mut(cwd, move |r| {
        branch_ops::rename(r, &c, &old_name, &new_name)
    })
    .await
}

/// 分支对比:双向唯一提交(limit 缺省 200,clamp 1..500)。
#[tauri::command]
pub async fn git_branch_compare(
    cwd: String,
    target: String,
    current: String,
    limit: Option<usize>,
) -> Result<BranchCompareSet, String> {
    run(cwd, move |r| {
        compare_ops::branch_compare(r, &target, &current, limit)
    })
    .await
}

/// 工作树对分支的差异文件清单(不带 patch)。
#[tauri::command]
pub async fn git_branch_worktree_files(
    cwd: String,
    branch: String,
) -> Result<Vec<BranchDiffFile>, String> {
    run(cwd, move |r| compare_ops::worktree_files(r, &branch)).await
}

/// 工作树对分支的单文件 patch(path 按 新路径/rename 来源 匹配)。
#[tauri::command]
pub async fn git_branch_worktree_patch(
    cwd: String,
    branch: String,
    path: String,
) -> Result<Option<FilePatch>, String> {
    run(cwd, move |r| compare_ops::worktree_patch(r, &branch, &path)).await
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
        // 带分支的 fetch:只刷新该分支上游引用(分支右键菜单「获取」)
        "fetch" => remote_ops::RemoteOp::Fetch,
        other => return Err(format!("E_EMPTY: 未知远端操作: {other}")),
    };
    // pull 会移动 HEAD → 写路径,成功 evict
    let cwd2 = cwd.clone();
    run_mut(cwd, move |r| remote_ops::run(r, &cwd2, op, branch)).await
}

/// 已配置远端名列表(推送/拉取对话框的远端下拉)。
#[tauri::command]
pub async fn git_remotes(cwd: String) -> Result<Vec<String>, String> {
    run(cwd, remote_ops::remotes).await
}

/// 推送预览:HEAD 相对 <remote>/<branch> 的独有提交(targetFound=false = 新分支首推)。
#[tauri::command]
pub async fn git_push_preview(
    cwd: String,
    remote: String,
    branch: String,
    limit: Option<usize>,
) -> Result<remote_ops::PushPreview, String> {
    let limit = limit.unwrap_or(120).clamp(1, 500);
    run(cwd, move |r| {
        remote_ops::push_preview(r, &remote, &branch, limit)
    })
    .await
}

/// 远端对话框结构化请求(fetch/pull/push 带选项);pull 会移动 HEAD → 写路径 evict。
#[tauri::command]
pub async fn git_remote_request(
    cwd: String,
    req: remote_ops::RemoteRequest,
) -> Result<String, String> {
    let cwd2 = cwd.clone();
    run_mut(cwd, move |r| remote_ops::run_request(r, &cwd2, req)).await
}
