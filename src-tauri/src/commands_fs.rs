//! CLI 探针/安装与 fs 系 Tauri 命令(自 lib.rs 拆出,文件规模铁则)。
//! 统一 async + spawn_blocking 纪律:重阻塞链路不占 Tauri 主线程。
//! invoke 字符串只按函数名匹配,前端调用面不变。

use tauri::AppHandle;

use crate::{fs, fs_walk, installer, probe, proc_run};

/// 探针某个 CLI 命令是否在本机 PATH 中可解析,以及其 `--version` 输出。
/// 返回 `probe::CliProbeResult`,前端按 found/path/version 渲染行卡。
///
/// 必须 async + spawn_blocking:同步 command 在 Tauri 主线程执行,而探针链路
/// (login shell spawn + `--version` 8s 超时)是重阻塞 —— 曾致 UI 卡死。
#[tauri::command]
pub(crate) async fn cli_probe(command: String) -> probe::CliProbeResult {
    tauri::async_runtime::spawn_blocking(move || probe::probe_cli(&command))
        .await
        .unwrap_or_else(|_| probe::CliProbeResult {
            command: String::new(),
            found: false,
            path: None,
            version: None,
            npm_prefix: None,
        })
}

/// 一键安装某个 CLI(按前端传入的参数化安装计划:npm 包 / 官方脚本)。
/// 流式日志经 Tauri event `cli-install://{id}` 推前端。
/// 必须 async + spawn_blocking:安装子进程分钟级阻塞,同步执行会卡死 UI。
#[tauri::command]
pub(crate) async fn cli_install_run(
    app: AppHandle,
    id: String,
    plan: installer::InstallPlan,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || installer::run_install(&app, &id, &plan))
        .await
        .map_err(|e| format!("install task join: {e}"))?
}

/// fs 系命令统一 async + spawn_blocking:目录递归/最大 20MB 读/base64 编码
/// 都是可感阻塞,同步执行跑在主线程会掉帧(cli_probe 同款纪律)。
#[tauri::command]
pub(crate) async fn fs_list_dir(path: String) -> Result<Vec<fs::DirEntry>, String> {
    spawn_fs(move || fs::list_dir(&path)).await
}

#[tauri::command]
pub(crate) async fn fs_read_file(path: String) -> Result<String, String> {
    spawn_fs(move || fs::read_file(&path)).await
}

#[tauri::command]
pub(crate) async fn read_local_image_data_url(path: String) -> Result<String, String> {
    spawn_fs(move || fs::read_local_image_data_url(&path)).await
}

#[tauri::command]
pub(crate) async fn read_binary_file_base64(path: String) -> Result<String, String> {
    spawn_fs(move || fs::read_binary_file_base64(&path)).await
}

#[tauri::command]
pub(crate) async fn fs_write_temp(name: String, data: Vec<u8>) -> Result<String, String> {
    spawn_fs(move || fs::write_temp_file(&name, &data)).await
}

#[tauri::command]
pub(crate) async fn fs_collect_files(
    dir: String,
    suffix: String,
) -> Result<Vec<fs::FileStamp>, String> {
    spawn_fs(move || fs::collect_files(&dir, &suffix)).await
}

/// 项目文件索引(composer `@` 补全候选):递归 + gitignore 系语义,见 fs_walk.rs。
#[tauri::command]
pub(crate) async fn fs_walk_files(root: String, cap: usize) -> Result<Vec<String>, String> {
    spawn_fs(move || fs_walk::walk_files(&root, cap)).await
}

/// 通用短进程通道(omp/pi RPC 副车查询、grok inspect):同步阻塞,spawn_blocking 包裹。
#[tauri::command]
pub(crate) async fn proc_communicate(
    spec: proc_run::ProcRunSpec,
) -> Result<proc_run::ProcRunResult, String> {
    tauri::async_runtime::spawn_blocking(move || proc_run::run(&spec))
        .await
        .map_err(|e| format!("proc_communicate join 失败: {e}"))?
}

#[tauri::command]
pub(crate) async fn fs_read_head(path: String, max_bytes: usize) -> Result<String, String> {
    spawn_fs(move || fs::read_head(&path, max_bytes)).await
}

#[tauri::command]
pub(crate) async fn fs_read_tail(path: String, max_bytes: usize) -> Result<String, String> {
    spawn_fs(move || fs::read_tail(&path, max_bytes)).await
}

#[tauri::command]
pub(crate) async fn fs_remove_path(path: String) -> Result<(), String> {
    spawn_fs(move || fs::remove_path(&path)).await
}

/// fs 命令公共模板:spawn_blocking 包裹 + JoinError 转 String。
pub(crate) async fn spawn_fs<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("fs 命令 join 失败: {e}"))?
}
