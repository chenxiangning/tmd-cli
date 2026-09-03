//! SSH Tauri 命令 —— invoke 入口(git/commands.rs 同款模板)。
//! 会话注册/输出/翻页复用既有 session_* 命令(按 kind 路由,见 lib.rs)。

use std::sync::Arc;

use tauri::{AppHandle, State};

use super::forward::{self, SshForwardInfo};
use super::sftp::{SftpEntry, SftpReadText, SftpWriteOutcome};
use super::sftp_transfer::{self, SftpTransferState};
use super::transport::SshHostWire;
use super::{control, known_hosts, session, SshRegistry};
use crate::session::SessionMeta;
use crate::AppState;

/// 创建 SSH 会话:立即注册会话表并返回 id,连接/认证在后台完成
/// (状态经 ssh://event/{id},提示经 ssh://prompt/{id})。
#[tauri::command]
pub async fn ssh_session_create(
    app: AppHandle,
    state: State<'_, AppState>,
    host: SshHostWire,
    cwd: String,
    workspace_id: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<crate::pty::SpawnedSession, String> {
    let host = host.normalized()?;
    let id = crate::pty::uuid_v4();
    let cols = cols.unwrap_or(super::SSH_DEFAULT_COLS).clamp(20, 400);
    let rows = rows.unwrap_or(super::SSH_DEFAULT_ROWS).clamp(6, 200);

    /* 会话日志:与 PTY 同构(~/.tmd-cli/session/ssh/<项目-slug>/<id>.log)。 */
    let log_path = crate::session_log::session_log_path("ssh", &cwd, &id);
    let log_file = log_path
        .parent()
        .and_then(|dir| std::fs::create_dir_all(dir).ok())
        .and_then(|_| {
            std::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&log_path)
                .ok()
        });
    let log_path = log_file.as_ref().map(|_| log_path);
    if let Some(path) = log_path.clone() {
        state.ssh.logs.lock().insert(
            id.clone(),
            crate::session_log::LogMeta {
                written: 0,
                base: 0,
                path,
            },
        );
    }

    let entry = Arc::new(super::SshSessionEntry {
        host: host.clone(),
        runtime: Arc::new(super::SshSessionRuntime::new()),
        cols: std::sync::atomic::AtomicUsize::new(usize::from(cols)),
        rows: std::sync::atomic::AtomicUsize::new(usize::from(rows)),
        log_file: parking_lot::Mutex::new(log_file),
        log_path,
    });
    state
        .ssh
        .sessions
        .lock()
        .insert(id.clone(), Arc::clone(&entry));
    state.sessions.register(SessionMeta {
        id: id.clone(),
        profile_id: "ssh".to_string(),
        cwd,
        workspace_id,
        created_at: crate::now_millis(),
        pid: None,
        kind: "ssh".to_string(),
        title: Some(if host.name.trim().is_empty() {
            format!("{}@{}", host.username.trim(), host.host.trim())
        } else {
            host.name.trim().to_string()
        }),
    });

    let registry = Arc::clone(&state.ssh);
    let session_id = id.clone();
    tauri::async_runtime::spawn(async move {
        session::connect_and_run(app, registry, session_id).await;
    });
    Ok(crate::pty::SpawnedSession { id, pid: None })
}

#[tauri::command]
pub fn ssh_session_status(state: State<'_, AppState>, session_id: String) -> String {
    state.ssh.status(&session_id)
}

#[tauri::command]
pub fn ssh_prompt_answer(
    state: State<'_, AppState>,
    prompt_id: String,
    answer: Option<String>,
    trust_host_key: Option<bool>,
) -> Result<(), String> {
    control::answer_prompt(
        &state.ssh,
        &prompt_id,
        answer,
        trust_host_key.unwrap_or(false),
    )
}

#[tauri::command]
pub fn ssh_prompt_cancel(state: State<'_, AppState>, prompt_id: String) -> Result<(), String> {
    control::cancel_prompt(&state.ssh, &prompt_id)
}

#[tauri::command]
pub async fn ssh_latency(state: State<'_, AppState>, session_id: String) -> Result<u32, String> {
    control::latency(&state.ssh, &session_id).await
}

// ---- known_hosts ----

#[tauri::command]
pub fn ssh_known_hosts_reset(host: String, port: u16) -> Result<bool, String> {
    known_hosts::reset(&host, port)
}

// ---- SFTP ----

#[tauri::command]
pub async fn ssh_sftp_list(
    session_id: String,
    path: Option<String>,
) -> Result<Vec<SftpEntry>, String> {
    super::sftp::list(&session_id, path).await
}

#[tauri::command]
pub async fn ssh_sftp_stat(session_id: String, path: String) -> Result<Option<SftpEntry>, String> {
    super::sftp::stat(&session_id, &path).await
}

#[tauri::command]
pub async fn ssh_sftp_read_text(
    session_id: String,
    path: String,
    offset: Option<u64>,
    max_bytes: Option<usize>,
) -> Result<SftpReadText, String> {
    super::sftp::read_text(&session_id, &path, offset, max_bytes).await
}

#[tauri::command]
pub async fn ssh_sftp_write_text(
    session_id: String,
    path: String,
    content: String,
    expected_mtime: Option<u64>,
    expected_size: Option<u64>,
) -> Result<SftpWriteOutcome, String> {
    super::sftp::write_text(&session_id, &path, &content, expected_mtime, expected_size).await
}

#[tauri::command]
pub async fn ssh_sftp_mkdir(session_id: String, path: String) -> Result<SftpEntry, String> {
    super::sftp::mkdir(&session_id, &path).await
}

#[tauri::command]
pub async fn ssh_sftp_rename(
    session_id: String,
    from_path: String,
    to_path: String,
) -> Result<SftpEntry, String> {
    super::sftp::rename(&session_id, &from_path, &to_path).await
}

#[tauri::command]
pub async fn ssh_sftp_delete(
    session_id: String,
    path: String,
    recursive: Option<bool>,
) -> Result<(), String> {
    super::sftp::delete(&session_id, &path, recursive.unwrap_or(false)).await
}

#[tauri::command]
pub fn ssh_sftp_transfer(
    session_id: String,
    direction: String,
    source_path: String,
    target_path: String,
    recursive: Option<bool>,
) -> Result<SftpTransferState, String> {
    sftp_transfer::start_transfer(
        session_id,
        direction,
        source_path,
        target_path,
        recursive.unwrap_or(false),
    )
}

#[tauri::command]
pub fn ssh_sftp_transfer_cancel(session_id: String, transfer_id: String) -> Result<(), String> {
    sftp_transfer::cancel_transfer(&session_id, &transfer_id)
}

#[tauri::command]
pub fn ssh_sftp_transfer_status(
    session_id: String,
    transfer_id: String,
) -> Result<SftpTransferState, String> {
    sftp_transfer::transfer_status(&session_id, &transfer_id)
}

// ---- 本地端口转发 ----

#[tauri::command]
pub async fn ssh_forward_start(
    session_id: String,
    remote_host: String,
    remote_port: u16,
    local_port: Option<u16>,
) -> Result<SshForwardInfo, String> {
    forward::global_forwards()
        .start(&session_id, remote_host, remote_port, local_port)
        .await
}

#[tauri::command]
pub fn ssh_forward_stop(session_id: String, forward_id: String) -> Result<(), String> {
    forward::global_forwards().stop(&session_id, &forward_id)
}

#[tauri::command]
pub fn ssh_forward_list(session_id: String) -> Vec<SshForwardInfo> {
    forward::global_forwards().list(&session_id)
}

#[tauri::command]
pub async fn ssh_forward_check_port(port: u16) -> bool {
    forward::local_port_available(port).await
}

/// AppState 的 SSH 成员初始化(SessionRegistry 伴生)。
pub fn new_registry() -> Arc<SshRegistry> {
    Arc::new(SshRegistry::new())
}
