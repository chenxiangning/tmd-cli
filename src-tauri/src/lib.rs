mod fs;
mod git;
mod pty;
mod quota;
mod session;
mod settings;

use pty::{PtyRegistry, SpawnSpec, SpawnedSession};
use session::{SessionMeta, SessionRegistry};
use tauri::webview::WebviewWindowBuilder;
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
        pid: spawned.pid,
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

#[tauri::command]
fn fs_collect_files(dir: String, suffix: String) -> Result<Vec<fs::FileStamp>, String> {
    fs::collect_files(&dir, &suffix)
}

#[tauri::command]
fn fs_read_head(path: String, max_bytes: usize) -> Result<String, String> {
    fs::read_head(&path, max_bytes)
}
 
#[tauri::command]
fn fs_read_tail(path: String, max_bytes: usize) -> Result<String, String> {
    fs::read_tail(&path, max_bytes)
}

/// 平台标识兜底:UA 探测失败时前端经此取真实 OS("macos"/"windows"/"linux")。
#[tauri::command]
fn platform_kind() -> &'static str {
    std::env::consts::OS
}

#[tauri::command]
fn config_home_dir() -> String {
    session::home_dir().to_string_lossy().to_string()
}

#[tauri::command]
fn config_default_workspace_root() -> String {
    session::default_workspace_root().to_string_lossy().to_string()
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
    settings::save_settings(&data).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    session::ensure_config_dir().ok();
    let sessions = session::SessionRegistry::default();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            pty: PtyRegistry::default(),
            sessions,
        })
        .setup(|app| {
            let mut window = WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
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
        });
    builder        .invoke_handler(tauri::generate_handler![
            platform_kind,
            session_spawn,
            session_list,
            session_write,
            session_resize,
            session_kill,
            fs_write_temp,
            quota::quota_fetch,
            quota::omp_auth_credential,
            quota::quota_env_value,
            fs_list_dir,
            fs_read_file,
            git_status,
            fs_collect_files,
            fs_read_head,
            fs_read_tail,
            config_home_dir,
            config_default_workspace_root,
            config_read_workspaces,
            config_write_workspaces,
            config_read_settings,
            config_write_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
