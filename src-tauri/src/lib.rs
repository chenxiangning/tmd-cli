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

#[tauri::command]
fn session_spawn(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    spec: SpawnSpec,
) -> Result<SpawnedSession, String> {
    let spawned = state.pty.spawn(&app, spec.clone())?;
    state.sessions.register(SessionMeta {
        id: spawned.id.clone(),
        profile_id,
        cwd: spec.cwd,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            pty: PtyRegistry::default(),
            sessions: SessionRegistry::default(),
        })
        .invoke_handler(tauri::generate_handler![
            session_spawn,
            session_list,
            session_write,
            session_resize,
            session_kill,
            fs_write_temp,
            fs_list_dir,
            fs_read_file,
            git_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
