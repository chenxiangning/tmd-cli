//! Tauri command 层 —— 账本生命周期命令,async + spawn_blocking(libgit2/文件 IO
//! 阻塞,同 git::commands 惯例)。cwd 为存储分库维度;会话链按 (session_id,
//! tmd_session_id) 双字段命中。

use super::{
    approve_batch, batch_patches, derive_batches, anchor_turn, prune, restore_batch, seal_turn,
    undo_revert, CkptError, RestoreOutcome,
};

async fn run<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, CkptError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("E_STORE: 任务调度失败: {e}"))?
        .map_err(Into::into)
}

/// 记第 N 轮锚点(prompt 发送瞬间)。隐式先封上一轮,再做 CLI 身份回填。
/// 失败不阻塞发送 —— 前端 catch 后重试一次。
#[tauri::command]
pub async fn checkpoint_anchor(
    cwd: String,
    session_id: String,
    tmd_session_id: String,
    prompt: String,
) -> Result<String, String> {
    run(move || {
        anchor_turn(&cwd, &session_id, &tmd_session_id, &prompt).map(|e| e.id)
    })
    .await
}

/// 显式封口(一轮对话结算):把最新锚点以来的变更固化成 turn 条目。
#[tauri::command]
pub async fn checkpoint_seal(
    cwd: String,
    session_id: String,
    tmd_session_id: String,
) -> Result<bool, String> {
    run(move || seal_turn(&cwd, &session_id, &tmd_session_id)).await
}

/// 批次清单(会话严格隔离;含 live 分类与状态合成)。
/// 按需调用:UI 打开/批次更新/还原后,不挂高频轮询。
#[tauri::command]
pub async fn checkpoint_list(
    cwd: String,
    session_id: String,
    tmd_session_id: String,
) -> Result<Vec<super::BatchInfo>, String> {
    run(move || derive_batches(&cwd, &session_id, &tmd_session_id)).await
}

/// 批次逐文件 unified patch(sealed 读账本,open 现算)。
#[tauri::command]
pub async fn checkpoint_batch_diff(
    cwd: String,
    batch_id: String,
) -> Result<Vec<super::CkptPatch>, String> {
    run(move || batch_patches(&cwd, &batch_id)).await
}

/// 回退整批或子集。返回守卫条目 id,反悔走 checkpoint_undo_revert。
#[tauri::command]
pub async fn checkpoint_restore(
    cwd: String,
    batch_id: String,
    paths: Option<Vec<String>>,
) -> Result<RestoreOutcome, String> {
    run(move || restore_batch(&cwd, &batch_id, paths)).await
}

/// 通过标记:纯标记,不动文件/不碰 git;approved 批仍可回退。
#[tauri::command]
pub async fn checkpoint_approve(cwd: String, batch_id: String) -> Result<(), String> {
    run(move || approve_batch(&cwd, &batch_id)).await
}

/// 反悔:用守卫条目写回回退前状态。
#[tauri::command]
pub async fn checkpoint_undo_revert(cwd: String, batch_id: String) -> Result<RestoreOutcome, String> {
    run(move || undo_revert(&cwd, &batch_id)).await
}

/// 保留策略清理(前端在设置变更/面板打开时低频调用)。返回移除的条目数。
#[tauri::command]
pub async fn checkpoint_prune(cwd: String, keep: usize, ttl_days: u32) -> Result<usize, String> {
    run(move || prune(&cwd, keep, ttl_days)).await
}
