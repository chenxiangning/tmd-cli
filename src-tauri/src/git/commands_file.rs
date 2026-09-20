//! 文件维度 git 命令 —— 文件历史 + blame(commands.rs 300 行铁则拆出,同 commands_pr 先例)。

use super::commands::run;
use super::{blame, file_log, BlameLine, FileLogEntry};

/// 文件维度提交历史(新→旧,上限 limit;合并提交只比对首父)。
#[tauri::command]
pub async fn git_file_log(
    cwd: String,
    path: String,
    limit: usize,
) -> Result<Vec<FileLogEntry>, String> {
    run(cwd, move |r| file_log::walk_file(r, &path, limit)).await
}

/// 逐行归属(工作区文件 vs 历史)。
#[tauri::command]
pub async fn git_blame(cwd: String, path: String) -> Result<Vec<BlameLine>, String> {
    run(cwd, move |r| blame::blame(r, &path)).await
}
