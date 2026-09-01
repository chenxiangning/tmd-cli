mod fs;
mod git;
mod pty;
mod session;

use pty::{PtyRegistry, SpawnSpec, SpawnedSession};
use session::{SessionMeta, SessionRegistry};
use tauri::{AppHandle, State};

struct AppState {
    pty: PtyRegistry,
    sessions: SessionRegistry,
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
fn session_spawn(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
       spec: SpawnSpec,
    workspace_id: Option<String>,
) -> Result<SpawnedSession, String> {
    let spawned = state.pty.spawn(&app, spec.clone())?;
    state.sessions.register(SessionMeta {
        id: spawned.id.clone(),
        profile_id,
        cwd: spec.cwd,
                workspace_id,
        created_at: now_millis(),
        display_label: None,
        pid: spawned.pid,
        cli_session_id: None,
    });
    Ok(spawned)
}

#[tauri::command]
fn session_list(state: State<'_, AppState>) -> Vec<SessionMeta> {
    state.sessions.list()
}

#[tauri::command]
fn session_write(state: State<'_, AppState>, id: String, data: String) -> Result<(), String> {
    state.pty.write(&id, &data)
}

#[tauri::command]
fn session_resize(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.pty.resize(&id, cols, rows)
}

#[tauri::command]
fn session_kill(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.sessions.remove(&id);
    state.pty.kill(&id)
}

#[tauri::command]
fn session_set_cli_session_id(
    state: State<'_, AppState>,
    id: String,
    cli_session_id: String,
) -> Result<(), String> {
    state.sessions.update_cli_session_id(&id, &cli_session_id);
    Ok(())
}

#[tauri::command]
fn fs_list_dir(path: String) -> Result<Vec<fs::DirEntry>, String> {
    fs::list_dir(&path)
}

#[tauri::command]
fn fs_read_file(path: String) -> Result<String, String> {
    fs::read_file(&path)
}

#[tauri::command]
fn fs_write_temp(name: String, data: Vec<u8>) -> Result<String, String> {
    fs::write_temp_file(&name, &data)
}

#[tauri::command]
fn git_status(cwd: String) -> Result<git::GitStatus, String> {
    git::status(&cwd)
}

#[tauri::command]
fn fs_latest_file(dir: String, suffix: String) -> Result<Option<String>, String> {
    fs::latest_file_in_dir(&dir, &suffix)
}

#[tauri::command]
fn config_home_dir() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/tmp".into())
}

#[tauri::command]
fn config_read_workspaces() -> session::WorkspacesFile {
    session::load_workspaces()
}

#[tauri::command]
fn config_write_workspaces(data: session::WorkspacesFile) -> Result<(), String> {
    session::save_workspaces(&data).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    session::ensure_config_dir().ok();
    let sessions = session::SessionRegistry::default();
    sessions.restore_from_disk();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            pty: PtyRegistry::default(),
            sessions,
        })
        .invoke_handler(tauri::generate_handler![
            session_spawn,
            session_list,
            session_write,
            session_resize,
            session_kill,
            session_set_cli_session_id,
            fs_write_temp,
            fs_list_dir,
            fs_read_file,
            git_status,
            fs_latest_file,
            config_home_dir,
            config_read_workspaces,
            config_write_workspaces,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
