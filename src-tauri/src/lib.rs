mod app_setup;
mod checkpoints;
mod commands_fs;
mod fs;
mod fs_edit;
mod fs_preview;
mod fs_remove;
mod fs_walk;
mod git;
mod hash;
mod installer;
mod probe;
mod proc_run;
mod proxy;
mod pty;
mod pty_spawn;
mod quota;
mod resolve;
mod session;
mod session_commands;
mod session_log;
mod settings;
mod sqlite;
mod ssh;

use pty::PtyRegistry;
use tauri::AppHandle;

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
        .manage(AppState {
            pty: PtyRegistry::default(),
            sessions,
            ssh: ssh_registry,
        })
        .setup(app_setup::setup)
        .invoke_handler(tauri::generate_handler![
            platform_kind,
            app_restart,
            commands_fs::cli_probe,
            commands_fs::cli_install_run,
            session_commands::session_spawn,
            session_commands::session_list,
            session_commands::session_write,
            session_commands::session_resize,
            session_commands::session_kill,
            session_commands::session_log_size,
            session_commands::session_history_page,
            commands_fs::fs_list_dir,
            commands_fs::fs_read_file,
            commands_fs::fs_write_temp,
            commands_fs::fs_collect_files,
            commands_fs::fs_read_head,
            commands_fs::fs_read_tail,
            commands_fs::fs_remove_path,
            commands_fs::fs_walk_files,
            commands_fs::proc_communicate,
            fs_edit::fs_write_file,
            fs_edit::fs_create_file,
            fs_edit::fs_create_dir,
            fs_edit::fs_rename_entry,
            fs_edit::fs_trash_entry,
            fs_edit::fs_reveal_in_file_manager,
            md5_hex,
            commands_fs::read_local_image_data_url,
            commands_fs::read_binary_file_base64,
            git::commands::git_status,
            git::commands::git_repos_scan,
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
            git::commands::git_fetch,
            git::commands::git_pull_push,
            git::commands::git_remotes,
            git::commands::git_push_preview,
            git::commands::git_remote_request,
            git::commands::git_smart_checkout,
            git::commands::git_smart_checkout_undo,
            quota::quota_fetch,
            quota::quota_env_value,
            sqlite::sqlite_query,
            sqlite::sqlite_execute,
            config_home_dir,
            config_default_workspace_root,
            config_read_workspaces,
            config_write_workspaces,
            config_read_settings,
            ssh::commands::ssh_session_create,
            ssh::commands::ssh_session_reconnect,
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
