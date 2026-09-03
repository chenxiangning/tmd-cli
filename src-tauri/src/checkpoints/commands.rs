//! Tauri command 层 —— 账本生命周期命令,async + spawn_blocking(libgit2/文件 IO
//! 阻塞,同 git::commands 惯例)。cwd 为存储分库维度;会话链按 (session_id,
//! tmd_session_id) 双字段命中。

use super::{
    anchor_turn, apply_batch, approve_batch, batch_patches, derive_batches, prune, record_edit,
    restore_batch, seal_dead_turns, seal_turn, undo_revert, CkptError, RestoreOutcome,
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
/// engine/model/thinking = 发送时刻的引擎与状态快照,随锚点固化。
/// attribution = 归因模式("events" | "git"):前端按 CLI profile 是否声明
/// editMarks 决定,随锚点定死。失败不阻塞发送 —— 前端 catch 后重试一次。
// 8 个扁平参数是 tauri invoke 契约(按字段名传参),分组结构体会破坏前端契约。
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn checkpoint_anchor(
    cwd: String,
    session_id: String,
    tmd_session_id: String,
    prompt: String,
    engine: String,
    model: String,
    thinking: String,
    attribution: Option<String>,
) -> Result<String, String> {
    run(move || {
        let attribution = attribution.unwrap_or_else(|| "git".into());
        anchor_turn(
            &cwd,
            &session_id,
            &tmd_session_id,
            &prompt,
            &engine,
            &model,
            &thinking,
            &attribution,
        )
        .map(|e| e.id)
    })
    .await
}

/// AI 写入事件流式记账(EditWatch / 会话磁盘事件拉取命中即调)。返回是否入账
/// (false = 无锚点/已封口/git 归因会话/迟到事件,被丢弃)。
/// ts = 写入事件时刻(None = PTY 标记无时刻),守卫早于锚点的上一轮尾巴。
#[tauri::command]
pub async fn checkpoint_record_edit(
    cwd: String,
    session_id: String,
    tmd_session_id: String,
    path: String,
    ts: Option<i64>,
) -> Result<bool, String> {
    run(move || record_edit(&cwd, &session_id, &tmd_session_id, &path, ts)).await
}

/// 应用:把账本固化的批后像精确写回磁盘(回退的镜像);执行前打守卫可反悔。
#[tauri::command]
pub async fn checkpoint_apply(
    cwd: String,
    batch_id: String,
    paths: Option<Vec<String>>,
) -> Result<RestoreOutcome, String> {
    run(move || apply_batch(&cwd, &batch_id, paths)).await
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

/// 死锚点收口(强退恢复):上一运行被 kill 的会话没有 sessionExited,
/// 最后一段轮次在账本里仍是开放锚点。前端在面板首次挂载时按 cwd 触发
/// 一次;grace_ms = 锚点新鲜度保护(避免误封本运行刚打的在途锚点,
/// 误封亦无损失 —— 封口是修订追加)。返回本次代封的锚点数。
#[tauri::command]
pub async fn checkpoint_seal_dead(cwd: String, grace_ms: i64) -> Result<usize, String> {
    run(move || seal_dead_turns(&cwd, grace_ms)).await
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
pub async fn checkpoint_undo_revert(
    cwd: String,
    batch_id: String,
) -> Result<RestoreOutcome, String> {
    run(move || undo_revert(&cwd, &batch_id)).await
}

/// 保留策略清理(前端在设置变更/面板打开时低频调用)。返回移除的条目数。
#[tauri::command]
pub async fn checkpoint_prune(cwd: String, keep: usize, ttl_days: u32) -> Result<usize, String> {
    run(move || prune(&cwd, keep, ttl_days)).await
}
