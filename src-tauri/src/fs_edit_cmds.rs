//! fs_edit 命令包装(2026-10-26 拆:fs_edit.rs 触 300 行铁则)—— Tauri command
//! 薄壳层,签名风格与 fs.rs 一致(snake_case 参数由前端传 camelCase)。
//! 统一 async + spawn_blocking(commands_fs 同款纪律):写盘/废纸篓/拉起
//! 文件管理器都是阻塞 IO,同步执行跑在主线程会掉帧。

use std::path::Path;

use super::fs_edit::{
    copy_file, copy_tree, create_dir, create_file, mtime_ms, rename_entry, reveal_in_file_manager,
    trash_entry, write_file,
};

#[tauri::command]
pub(crate) async fn fs_write_file(
    path: String,
    content: String,
    expect_mtime: Option<u64>,
) -> Result<u64, String> {
    crate::commands_fs::spawn_fs(move || write_file(&path, &content, expect_mtime)).await
}

/// 磁盘 mtime(毫秒):编辑器打开时取基线,保存前比对(乐观锁的另一端)。
#[tauri::command]
pub(crate) async fn fs_mtime(path: String) -> Result<Option<u64>, String> {
    crate::commands_fs::spawn_fs(move || Ok(mtime_ms(Path::new(&path)))).await
}

#[tauri::command]
pub(crate) async fn fs_create_file(path: String) -> Result<(), String> {
    crate::commands_fs::spawn_fs(move || create_file(&path)).await
}

#[tauri::command]
pub(crate) async fn fs_create_dir(path: String) -> Result<(), String> {
    crate::commands_fs::spawn_fs(move || create_dir(&path)).await
}

#[tauri::command]
pub(crate) async fn fs_rename_entry(path: String, new_name: String) -> Result<String, String> {
    crate::commands_fs::spawn_fs(move || rename_entry(&path, &new_name)).await
}

#[tauri::command]
pub(crate) async fn fs_trash_entry(path: String) -> Result<(), String> {
    crate::commands_fs::spawn_fs(move || trash_entry(&path)).await
}

#[tauri::command]
pub(crate) async fn fs_reveal_in_file_manager(path: String) -> Result<(), String> {
    crate::commands_fs::spawn_fs(move || reveal_in_file_manager(&path)).await
}

#[tauri::command]
pub(crate) async fn fs_copy_file(src: String, dst: String) -> Result<(), String> {
    crate::commands_fs::spawn_fs(move || copy_file(&src, &dst)).await
}

#[tauri::command]
pub(crate) async fn fs_copy_tree(src: String, dst: String) -> Result<(), String> {
    crate::commands_fs::spawn_fs(move || copy_tree(&src, &dst)).await
}
