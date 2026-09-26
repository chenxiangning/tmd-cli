// file-size-exempt: 301 行仅超 1 行,含文件头注释;拆出即伤对照性(dispatch 是命令面镜像总表,lib.rs 是装配总表)。
mod app_setup;
mod checkpoints;
mod commands_fs;
mod event_sink;
mod fs;
mod fs_edit;
mod fs_preview;
mod fs_remove;
mod fs_search;
mod fs_tail;
mod fs_walk;
mod git;
mod hash;
mod installer;
mod lsp;
mod lsp_framing;
mod open_with;
mod plugins;
mod probe;
mod probe_prefix;
mod proc_run;
mod proxy;
mod pty;
mod pty_spawn;
mod quota;
mod resolve;
mod session;
mod session_commands;
mod session_disk_log;
mod session_log;
mod settings;
mod sqlite;
mod ssh;
mod web;
mod wsl;
mod wsl_remote;
mod wsl_remote_ops;
use pty::PtyRegistry;
use tauri::{AppHandle, Manager};

pub(crate) struct AppState {
    pty: PtyRegistry,
    sessions: session::SessionRegistry,
    ssh: std::sync::Arc<ssh::SshRegistry>,
    web: web::state::WebAccessState,
    relay: web::relay::RelayState,
    devices: web::devices::DeviceRegistry,
}

pub(crate) fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
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

/// 重启应用(插件市场"拔插 = 重启生效"的一键入口)。
/// 必须走 request_restart 经事件循环触发 ExitRequested/Exit,RunEvent::Exit
/// 的 kill_all 才会执行;直调 restart() 在主线程会跳过事件直接重启,PTY 成孤儿。
#[tauri::command]
fn app_restart(app: AppHandle) {
    app.request_restart();
}

#[tauri::command]
fn config_home_dir() -> String {
    session::home_dir().to_string_lossy().to_string()
}

/// 应用配置目录(~/.tmd-cli):布局 owner 是 session.rs,插件不应自拼。
#[tauri::command]
fn config_dir() -> String {
    session::config_dir().to_string_lossy().to_string()
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
fn config_merge_settings(app: AppHandle, patch: serde_json::Value) -> Result<(), String> {
    let merged = settings::merge_settings(&patch)?;
    /* 网络代理字段变化即时生效:合并落盘后应用到进程 env,
    之后 spawn 的 PTY 子进程与 reqwest 新请求即走代理(旧会话不受影响)。 */
    proxy::apply_and_report(&merged);
    /* Web 访问开关跟随设置(web_access::apply_settings 内部异步起停桥)。
    以合并后整树为准 —— 陈旧补丁域不参与,桥不会被内存旧值误杀(00d3dc5)。 */
    web::web_access::apply_settings(&app, &merged);
    Ok(())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    /* panic 钩子最先装:任何后续启动路径上的 panic 都有现场可查。 */
    app_setup::install_panic_logger();
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
        /* 应用内自动更新(updater latest.json 通道)与安装后重启;前端经
        kernel/ipc 薄包装调用 check/download_and_install/relaunch。 */
        .plugin(tauri_plugin_updater::Builder::new().build())
        /* 进程面控:relaunch(更新安装后自动重启)等;e710fc8 误删致 relaunch 必败,恢复。 */
        .plugin(tauri_plugin_process::init())
        // 系统通知:Ask 等待/轮次结束/会话退出的桌面级提醒(notify 插件消费,
        // 前端经 kernel/ipc 薄包装调用,架构铁律 R3)。
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            pty: PtyRegistry::default(),
            sessions,
            ssh: ssh_registry,
            web: web::state::WebAccessState::default(),
            relay: web::relay::RelayState::default(),
            devices: web::devices::DeviceRegistry::default(),
        })
        .setup(|app| {
            app_setup::setup(app)?;
            web::web_access::autostart(app.handle());
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Some((url, key)) = web::relay::autostart_target(&settings::load_settings()) {
                    let _ = web::relay::web_relay_start(app_handle, url, key).await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform_kind,
            app_restart,
            commands_fs::cli_probe,
            commands_fs::cli_install_run,
            wsl::wsl_info,
            wsl_remote::wsl_remote_info,
            session_commands::session_spawn,
            wsl_remote_ops::wsl_list_dir,
            wsl_remote_ops::wsl_probe_engines,
            wsl_remote_ops::wsl_read_file_text,
            wsl_remote_ops::wsl_exec,
            ssh::commands::ssh_prompts_pending,
            session_commands::session_list,
            session_commands::session_set_workspace,
            session_commands::session_bind_cli,
            session_commands::session_write,
            session_commands::session_resize,
            session_commands::session_kill,
            session_commands::session_log_size,
            session_commands::session_size,
            session_commands::session_link_log,
            session_commands::session_disk_tail,
            session_commands::session_history_page,
            commands_fs::fs_list_dir,
            commands_fs::fs_read_file,
            commands_fs::fs_write_temp,
            commands_fs::fs_collect_files,
            commands_fs::fs_read_head,
            commands_fs::fs_read_tail,
            commands_fs::fs_read_tail_changed,
            commands_fs::fs_remove_path,
            commands_fs::fs_search,
            commands_fs::fs_walk_files,
            commands_fs::fs_walk_index,
            commands_fs::proc_communicate,
            lsp::lsp_spawn,
            lsp::lsp_send,
            lsp::lsp_stop,
            fs_edit::fs_write_file,
            fs_edit::fs_create_file,
            fs_edit::fs_create_dir,
            fs_edit::fs_rename_entry,
            fs_edit::fs_trash_entry,
            fs_edit::fs_reveal_in_file_manager,
            fs_edit::fs_copy_file,
            open_with::fs_open_with,
            open_with::fs_probe_open_app,
            open_with::fs_open_app_icon,
            md5_hex,
            commands_fs::read_local_image_data_url,
            commands_fs::read_binary_file_base64,
            git::commands::git_status,
            git::commands::git_repos_scan,
            git::commands::git_ignored_prefixes,
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
            plugins::plugin_scan,
            plugins::plugin_read_file,
            plugins::plugin_archive,
            plugins::plugin_rollback,
            plugins::plugin_delete,
            checkpoints::commands::checkpoint_prune,
            git::commands::git_totals,
            git::commands::git_ahead_behind,
            git::commands::git_diff_file_patch,
            git::commands::git_stage,
            git::commands::git_unstage,
            git::commands::git_discard,
            git::commands::git_clean,
            git::commands::git_commit,
            git::commands::git_log,
            git::commands_file::git_file_log,
            git::commands_file::git_blame,
            git::commands::git_commit_files,
            git::commands::git_commit_file_patch,
            git::commands::git_commit_message,
            git::commands::git_branches,
            git::commands::git_checkout,
            git::commands::git_checkout_remote,
            git::commands::git_create_branch,
            git::commands::git_delete_branch,
            git::commands::git_merge_branch,
            git::commands::git_rebase_branch,
            git::commands::git_rename_branch,
            git::commands::git_branch_compare,
            git::commands::git_branch_worktree_files,
            git::commands::git_branch_worktree_patch,
            git::commands::git_pull_push,
            git::commands::git_remotes,
            git::commands::git_push_preview,
            git::commands::git_remote_request,
            git::commands_pr::git_pr_defaults,
            git::commands_pr::git_pr_run,
            git::commands::git_smart_checkout,
            git::commands::git_smart_checkout_undo,
            quota::quota_fetch,
            quota::quota_env_value,
            sqlite::sqlite_query,
            sqlite::sqlite_execute,
            config_home_dir,
            config_dir,
            config_default_workspace_root,
            config_read_workspaces,
            config_write_workspaces,
            config_read_settings,
            ssh::commands::ssh_session_create,
            ssh::commands::ssh_session_reconnect,
            ssh::commands::ssh_prompt_answer,
            ssh::commands::ssh_prompt_cancel,
            ssh::commands::ssh_latency,
            ssh::commands::ssh_known_hosts_reset,
            ssh::commands::ssh_sftp_list,
            ssh::commands::ssh_sftp_read_text,
            ssh::commands::ssh_sftp_write_text,
            ssh::commands::ssh_sftp_mkdir,
            ssh::commands::ssh_sftp_rename,
            ssh::commands::ssh_sftp_delete,
            ssh::commands::ssh_sftp_transfer,
            ssh::commands::ssh_sftp_transfer_cancel,
            ssh::commands::ssh_forward_start,
            ssh::commands::ssh_forward_stop,
            ssh::commands::ssh_forward_list,
            ssh::commands::ssh_forward_check_port,
            config_merge_settings,
            web::web_access::web_access_start,
            web::web_access::web_access_stop,
            web::relay::web_relay_start,
            web::relay::web_relay_stop,
            web::relay::web_relay_status,
            web::relay::relay_deploy,
            web::relay::relay_deploy_pack,
            web::relay_selfhost::relay_deploy_selfhost,
            web::relay_selfhost_pack::relay_selfhost_pack,
            web::web_access::web_access_status,
            web::web_access::web_pair_offer,
            web::web_access::web_devices_list,
            web::web_access::web_device_approve,
            web::web_access::web_device_revoke,
            web::web_access::remote_control_active,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            /* 退出清场:杀掉全部 PTY 子进程,防孤儿常驻(见 PtyRegistry::kill_all)。
            webview 重载不触发此事件,会话跨重载存活的语义不变。 */
            if let tauri::RunEvent::Exit = event {
                app.state::<AppState>().pty.kill_all();
            }
        });
}
