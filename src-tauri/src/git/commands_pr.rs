//! 创建 PR 的 Tauri command 层 —— 自 commands.rs 拆出(文件规模铁则)。
//! 复用 commands::{run, with_repo_mut} 模板:defaults 走读路径,工作流走写路径
//! (fetch/push 移动引用,成功 evict 缓存)。

use super::commands::run;
use super::{pr_defaults, pr_workflow, with_repo_mut};

/// 创建 PR defaults(upstream/origin 解析 + 模板兜底;不可创建时带人话原因)。
#[tauri::command]
pub async fn git_pr_defaults(cwd: String) -> Result<pr_defaults::PrDefaults, String> {
    run(cwd, pr_defaults::defaults).await
}

/// 创建 PR 四步工作流(precheck→push→createPr→comment);阶段经 git://pr-stage 实时推送。
/// 软失败(闸门确认/推送失败/评论失败)在 ok=false 结果体内,Err 只留给仓库级硬错。
#[tauri::command]
pub async fn git_pr_run(
    cwd: String,
    req: pr_workflow::PrRequest,
    app: tauri::AppHandle,
) -> Result<pr_workflow::PrWorkflowResult, String> {
    let cwd2 = cwd.clone();
    tauri::async_runtime::spawn_blocking(move || {
        with_repo_mut(&cwd, |r| pr_workflow::run(r, &cwd2, req, app))
    })
    .await
    .map_err(|e| format!("E_GIT2: 任务调度失败: {e}"))?
    .map_err(Into::into)
}
