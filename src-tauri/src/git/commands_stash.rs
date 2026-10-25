//! stash 域 Tauri 命令 —— 自 commands.rs 拆出(300 行铁则,同 commands_file 先例):
//! 「暂存并切换」一对 + stash 管理面三令(0.4.5)。全部写路径(run_mut),
//! spawn_blocking 纪律与 commands.rs 相同。

use super::{commands::run_mut, stash_ops};

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

/// stash 列表(管理面,0.4.5):run_mut 只为 &mut(stash_foreach 契约),读语义无副作用。
#[tauri::command]
pub async fn git_stash_list(cwd: String) -> Result<Vec<stash_ops::StashEntry>, String> {
    run_mut(cwd, stash_ops::list).await
}

/// 应用 stash 条目(keep = 保留条目;false = 弹出,冲突保留不丢)。
#[tauri::command]
pub async fn git_stash_apply(cwd: String, index: u32, keep: bool) -> Result<(), String> {
    run_mut(cwd, move |r| stash_ops::apply(r, index, keep)).await
}

/// 丢弃 stash 条目(不可逆,前端确认框把关)。
#[tauri::command]
pub async fn git_stash_drop(cwd: String, index: u32) -> Result<(), String> {
    run_mut(cwd, move |r| stash_ops::drop(r, index)).await
}
