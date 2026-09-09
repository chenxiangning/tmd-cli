//! plugins.rs 的 Tauri 命令薄层(经 #[path] 引入为 cmds 模块;async + spawn_blocking,不占主线程)。

use super::*;

#[tauri::command]
pub(crate) async fn plugin_scan() -> Result<Vec<PluginScanEntry>, String> {
    crate::commands_fs::spawn_fs(move || scan_plugins(&plugins_root())).await
}

#[tauri::command]
pub(crate) async fn plugin_read_file(id: String, name: String) -> Result<String, String> {
    crate::commands_fs::spawn_fs(move || read_plugin_file(&plugins_root(), &id, &name)).await
}

#[tauri::command]
pub(crate) async fn plugin_read_version(id: String, file: String) -> Result<String, String> {
    crate::commands_fs::spawn_fs(move || read_version_file(&plugins_root(), &id, &file)).await
}

#[tauri::command]
pub(crate) async fn plugin_archive(id: String) -> Result<Option<String>, String> {
    crate::commands_fs::spawn_fs(move || archive_current(&plugins_root(), &id)).await
}

#[tauri::command]
pub(crate) async fn plugin_rollback(id: String, file: String) -> Result<(), String> {
    crate::commands_fs::spawn_fs(move || rollback(&plugins_root(), &id, &file)).await
}

#[tauri::command]
pub(crate) async fn plugin_delete(id: String) -> Result<(), String> {
    crate::commands_fs::spawn_fs(move || trash_plugin(&plugins_root(), &id)).await
}
