//! Tauri command 层 —— 6 个命令,async + spawn_blocking(libgit2/文件 IO 阻塞,
//! 同 git::commands 惯例);cwd 为唯一维度。

use super::{
    batch_patches, derive_batches, prune, restore_batch, undo_revert, capture_snapshot,
    capture::SnapKind, CkptError, RestoreOutcome, Snapshot,
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

/// 锚点快照:用户消息发送瞬间由前端调用。失败不阻塞发送 —— 前端 catch 后重试一次。
#[tauri::command]
pub async fn checkpoint_capture(
    cwd: String,
    session_id: String,
    prompt: String,
) -> Result<Snapshot, String> {
    run(move || capture_snapshot(&cwd, &session_id, &prompt, SnapKind::Anchor)).await
}

/// 批次清单(含 live 分类与状态合成)。按需调用:UI 打开/批次更新/还原后,不挂轮询。
#[tauri::command]
pub async fn checkpoint_list(cwd: String) -> Result<Vec<super::BatchInfo>, String> {
    run(move || derive_batches(&cwd)).await
}

/// sealed 批次逐文件 unified patch。
#[tauri::command]
pub async fn checkpoint_batch_diff(
    cwd: String,
    batch_id: String,
) -> Result<Vec<super::diff::CkptPatch>, String> {
    run(move || batch_patches(&cwd, &batch_id)).await
}

/// 回退整批或子集。返回恢复点 id,反悔走 checkpoint_undo_revert。
#[tauri::command]
pub async fn checkpoint_restore(
    cwd: String,
    batch_id: String,
    paths: Option<Vec<String>>,
) -> Result<RestoreOutcome, String> {
    run(move || restore_batch(&cwd, &batch_id, paths)).await
}

/// 反悔:用守卫快照写回回退前状态。
#[tauri::command]
pub async fn checkpoint_undo_revert(cwd: String, batch_id: String) -> Result<RestoreOutcome, String> {
    run(move || undo_revert(&cwd, &batch_id)).await
}

/// 保留策略清理(前端在设置变更/面板打开时低频调用)。返回删除的批次数。
#[tauri::command]
pub async fn checkpoint_prune(cwd: String, keep: usize, ttl_days: u32) -> Result<usize, String> {
    run(move || prune(&cwd, keep, ttl_days)).await
}
