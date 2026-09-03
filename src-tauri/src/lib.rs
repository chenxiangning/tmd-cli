mod checkpoints;
mod fs;
mod fs_edit;
mod git;
mod hash;
mod installer;
mod omp_auth;
mod probe;
mod proxy;
mod pty;
mod quota;
mod resolve;
mod session;
mod session_commands;
mod session_log;
mod settings;
mod ssh;

use pty::PtyRegistry;
use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, Manager};

pub(crate) struct AppState {
    pty: PtyRegistry,
    sessions: session::SessionRegistry,
    ssh: std::sync::Arc<ssh::SshRegistry>,
}

pub(crate) fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// panic 落盘钩子:消息/位置/线程追加到 `~/.tmd-cli/panic.log`(上限 1MB 截断)。
///
/// 背景(2026-09-03 崩溃归因):wry WKURLSchemeHandler 竞态 panic 发生在 tokio
/// 任务里,GUI 进程 stderr 无处可看、release 又 strip,崩溃只剩一份无符号 .ips。
/// unwind 语义下任务 panic 被 tokio 捕获不至于灭进程,这里再把首条现场写盘,
/// 让下一次异常可以直接对到 crate 源码行,不再依赖"同源码重构建比对偏移"。
fn install_panic_logger() {
    let log_path = session::config_dir().join("panic.log");
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let thread_name = thread.name().unwrap_or("<unnamed>").to_string();
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "<unknown>".to_string());
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "<non-string panic payload>".to_string());
        let line = format!(
            "[{}] thread '{thread_name}' panicked at {location}: {payload}\n",
            now_millis()
        );
        eprint!("{line}");
        if let Some(parent) = log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        // 上限保护:超 1MB 先清空,防长期运行撑爆磁盘(panic 应是罕见事件)。
        if let Ok(meta) = std::fs::metadata(&log_path) {
            if meta.len() > 1024 * 1024 {
                let _ = std::fs::write(&log_path, "");
            }
        }
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()));
    }));
}

/// 探针某个 CLI 命令是否在本机 PATH 中可解析,以及其 `--version` 输出。
/// 返回 `probe::CliProbeResult`,前端按 found/path/version 渲染行卡。
///
/// 必须 async + spawn_blocking:同步 command 在 Tauri 主线程执行,而探针链路
/// (login shell spawn + `--version` 8s 超时)是重阻塞 —— 曾致 UI 卡死。
#[tauri::command]
async fn cli_probe(command: String) -> probe::CliProbeResult {
    tauri::async_runtime::spawn_blocking(move || probe::probe_cli(&command))
        .await
        .unwrap_or_else(|_| probe::CliProbeResult {
            command: String::new(),
            found: false,
            path: None,
            version: None,
        })
}

/// 一键安装某个 CLI(claude 走官方 native 安装器,其余 npm -g)。
/// 流式日志经 Tauri event `cli-install://{engine}` 推前端。
/// 必须 async + spawn_blocking:安装子进程分钟级阻塞,同步执行会卡死 UI。
#[tauri::command]
async fn cli_install_run(
    app: AppHandle,
    engine: installer::CliInstallEngine,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || installer::run_install(&app, engine))
        .await
        .map_err(|e| format!("install task join: {e}"))?
}

/// fs 系命令统一 async + spawn_blocking:目录递归/最大 20MB 读/base64 编码
/// 都是可感阻塞,同步执行跑在主线程会掉帧(cli_probe 同款纪律)。
#[tauri::command]
async fn fs_list_dir(path: String) -> Result<Vec<fs::DirEntry>, String> {
    spawn_fs(move || fs::list_dir(&path)).await
}

#[tauri::command]
async fn fs_read_file(path: String) -> Result<String, String> {
    spawn_fs(move || fs::read_file(&path)).await
}

#[tauri::command]
async fn read_local_image_data_url(path: String) -> Result<String, String> {
    spawn_fs(move || fs::read_local_image_data_url(&path)).await
}

#[tauri::command]
async fn read_binary_file_base64(path: String) -> Result<String, String> {
    spawn_fs(move || fs::read_binary_file_base64(&path)).await
}

#[tauri::command]
async fn fs_write_temp(name: String, data: Vec<u8>) -> Result<String, String> {
    spawn_fs(move || fs::write_temp_file(&name, &data)).await
}

#[tauri::command]
async fn fs_collect_files(dir: String, suffix: String) -> Result<Vec<fs::FileStamp>, String> {
    spawn_fs(move || fs::collect_files(&dir, &suffix)).await
}

#[tauri::command]
async fn fs_read_head(path: String, max_bytes: usize) -> Result<String, String> {
    spawn_fs(move || fs::read_head(&path, max_bytes)).await
}

#[tauri::command]
async fn fs_read_tail(path: String, max_bytes: usize) -> Result<String, String> {
    spawn_fs(move || fs::read_tail(&path, max_bytes)).await
}

#[tauri::command]
async fn fs_remove_path(path: String) -> Result<(), String> {
    spawn_fs(move || fs::remove_path(&path)).await
}

/// fs 命令公共模板:spawn_blocking 包裹 + JoinError 转 String。
async fn spawn_fs<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("fs 命令 join 失败: {e}"))?
}

/// 字符串 MD5(小写 hex)。kimi 会话目录按 MD5(cwd) 命名,前端据此定位会话目录;
/// 通用哈希原语,不携带 CLI 语义。纯内存计算,同步执行无阻塞风险。
#[tauri::command]
fn md5_hex(text: String) -> String {
    hash::md5_hex(text)
}

/// 平台标识兜底:UA 探测失败时前端经此取真实 OS("macos"/"windows"/"linux")。
#[tauri::command]
fn platform_kind() -> &'static str {
    std::env::consts::OS
}

/// 重启应用(插件市场"拔插 = 重启生效"的一键入口;进程替换,永不返回)。
#[tauri::command]
fn app_restart(app: AppHandle) {
    app.restart();
}

#[tauri::command]
fn config_home_dir() -> String {
    session::home_dir().to_string_lossy().to_string()
}

#[tauri::command]
fn config_default_workspace_root() -> String {
    session::default_workspace_root()
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
fn config_read_workspaces() -> session::WorkspacesFile {
    session::load_workspaces()
}

#[tauri::command]
fn config_write_workspaces(data: session::WorkspacesFile) -> Result<(), String> {
    session::save_workspaces(&data).map_err(|e| e.to_string())
}

#[tauri::command]
fn config_read_settings() -> serde_json::Value {
    settings::load_settings()
}

#[tauri::command]
fn config_write_settings(data: serde_json::Value) -> Result<(), String> {
    settings::save_settings(&data).map_err(|e| e.to_string())?;
    /* 网络代理字段变化即时生效:写盘成功后应用到进程 env,
    之后 spawn 的 PTY 子进程与 reqwest 新请求即走代理(旧会话不受影响)。 */
    proxy::apply_and_report(&data);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    /* panic 钩子最先装:任何后续启动路径上的 panic 都有现场可查。 */
    install_panic_logger();
    /* 打包 .app(launchd 环境)PATH 贫瘠,需用 login shell PATH 修复进程环境,
    让 git 等裸命令名调用与 PTY 子进程都能解析。
    但 enriched_path 要 fork login shell(两级 -lc/-ilc),慢 shellrc 下秒级,
    同步执行会阻塞建窗 —— 挪到后台线程,窗口先行。

    时序依据(消费链核实):
    - PTY spawn(pty.rs)首次访问自行触发缓存计算 + 显式 cmd.env("PATH", …),
      不依赖进程级 set_var 的就绪时刻;
    - git.rs/probe.rs 的裸命令名解析读进程 PATH,但二者都是建窗后由前端
      IPC 触发,此时后台线程早已落地;PATH_CACHE 单飞,结果跨线程可见;
      缓存降级(login shell 超时)时后台重试自愈,probe 走同步重算。 */
    std::thread::spawn(|| {
        std::env::set_var("PATH", resolve::enriched_path());
    });
    session::ensure_config_dir().ok();
    /* 启动即应用已存的网络代理设置(读本地文件 + set_var,微秒级,同步执行
    换确定性:任何子进程 spawn / reqwest 之前 env 已就位)。 */
    proxy::apply_and_report(&settings::load_settings());
    let sessions = session::SessionRegistry::default();
    let ssh_registry = ssh::commands::new_registry();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            pty: PtyRegistry::default(),
            sessions,
            ssh: ssh_registry,
        })
        .setup(|app| {
            /* SSH 引擎全局注入(forward/sftp 后台任务的注册表回取)。 */
            {
                let state = app.state::<AppState>();
                ssh::attach_globals(Some(app.handle()), &state.ssh);
            }
            let mut window =
                WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
                    /* 禁用 Tauri 原生 drop handler —— 让 HTML5 drop event 在 webview 内正常派发
                    否则 Tauri 拦截文件拖放,只发 tauri://drag-drop 事件,composer 收不到 */
                    .disable_drag_drop_handler()
                    .title("tmd-cli")
                    .inner_size(1440.0, 900.0)
                    .min_inner_size(960.0, 600.0);

            #[cfg(target_os = "windows")]
            {
                window = window.decorations(false);
            }

            #[cfg(target_os = "macos")]
            {
                window = window
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .hidden_title(true);
            }

            window.build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform_kind,
            app_restart,
            cli_probe,
            cli_install_run,
            session_commands::session_spawn,
            session_commands::session_list,
            session_commands::session_write,
            session_commands::session_resize,
            session_commands::session_kill,
            session_commands::session_log_size,
            session_commands::session_history_page,
            fs_list_dir,
            fs_read_file,
            fs_write_temp,
            fs_collect_files,
            fs_read_head,
            fs_read_tail,
            fs_remove_path,
            fs_edit::fs_write_file,
            fs_edit::fs_create_file,
            fs_edit::fs_create_dir,
            fs_edit::fs_rename_entry,
            fs_edit::fs_trash_entry,
            fs_edit::fs_reveal_in_file_manager,
            md5_hex,
            read_local_image_data_url,
            read_binary_file_base64,
            git::commands::git_status,
            checkpoints::commands::checkpoint_anchor,
            checkpoints::commands::checkpoint_record_edit,
            checkpoints::commands::checkpoint_seal,
            checkpoints::commands::checkpoint_seal_dead,
            checkpoints::commands::checkpoint_list,
            checkpoints::commands::checkpoint_batch_diff,
            checkpoints::commands::checkpoint_restore,
            checkpoints::commands::checkpoint_apply,
            checkpoints::commands::checkpoint_approve,
            checkpoints::commands::checkpoint_undo_revert,
            checkpoints::commands::checkpoint_prune,
            git::commands::git_totals,
            git::commands::git_ahead_behind,
            git::commands::git_diff_file_patch,
            git::commands::git_stage,
            git::commands::git_unstage,
            git::commands::git_discard,
            git::commands::git_commit,
            git::commands::git_log,
            git::commands::git_commit_files,
            git::commands::git_commit_file_patch,
            git::commands::git_branches,
            git::commands::git_checkout,
            git::commands::git_create_branch,
            git::commands::git_delete_branch,
            git::commands::git_fetch,
            git::commands::git_pull_push,
            quota::quota_fetch,
            quota::quota_env_value,
            omp_auth::omp_auth_credential,
            omp_auth::omp_auth_providers,
            config_home_dir,
            config_default_workspace_root,
            config_read_workspaces,
            config_write_workspaces,
            config_read_settings,
            ssh::commands::ssh_session_create,
            ssh::commands::ssh_session_status,
            ssh::commands::ssh_prompt_answer,
            ssh::commands::ssh_prompt_cancel,
            ssh::commands::ssh_latency,
            ssh::commands::ssh_known_hosts_reset,
            ssh::commands::ssh_sftp_list,
            ssh::commands::ssh_sftp_stat,
            ssh::commands::ssh_sftp_read_text,
            ssh::commands::ssh_sftp_write_text,
            ssh::commands::ssh_sftp_mkdir,
            ssh::commands::ssh_sftp_rename,
            ssh::commands::ssh_sftp_delete,
            ssh::commands::ssh_sftp_transfer,
            ssh::commands::ssh_sftp_transfer_cancel,
            ssh::commands::ssh_sftp_transfer_status,
            ssh::commands::ssh_forward_start,
            ssh::commands::ssh_forward_stop,
            ssh::commands::ssh_forward_list,
            ssh::commands::ssh_forward_check_port,
            config_write_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
