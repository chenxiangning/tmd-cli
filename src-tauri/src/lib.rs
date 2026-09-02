mod fs;
mod git;
mod installer;
mod omp_auth;
mod probe;
mod pty;
mod quota;
mod resolve;
mod session;
mod session_log;
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

#[tauri::command]
fn session_spawn(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    spec: SpawnSpec,
    workspace_id: Option<String>,
) -> Result<SpawnedSession, String> {
    let spawned = state.pty.spawn(&app, &profile_id, spec.clone())?;
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

/// 会话输出日志的绝对末尾偏移;无日志(创建失败/会话已退出)返回 0。
#[tauri::command]
fn session_log_size(state: State<'_, AppState>, id: String) -> u64 {
    state.pty.session_log_end(&id).unwrap_or(0)
}

/// 幕布往前翻页:before 绝对偏移之前最多 max_bytes 字节的原始输出。
#[tauri::command]
fn session_history_page(
    state: State<'_, AppState>,
    id: String,
    before: u64,
    max_bytes: u64,
) -> Result<session_log::HistoryPage, String> {
    state.pty.session_history_page(&id, before, max_bytes)
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
fn read_local_image_data_url(path: String) -> Result<String, String> {
    fs::read_local_image_data_url(&path)
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
    /* 打包 .app(launchd 环境)PATH 贫瘠,需用 login shell PATH 修复进程环境,
       让 git 等裸命令名调用与 PTY 子进程都能解析。
       但 enriched_path 要 fork login shell(-ilc),慢 shellrc 下可达数百 ms,
       同步执行会阻塞建窗 —— 挪到后台线程,窗口先行。

       时序依据(消费链核实):
       - PTY spawn(pty.rs)自带 LazyLock 解析 + 显式 cmd.env("PATH", …),
         不依赖进程级 set_var 的就绪时刻,首个 spawn 时按需计算;
       - git.rs/probe.rs 的裸命令名解析读进程 PATH,但二者都是建窗后由前端
         IPC 触发,此时后台线程早已落地;LazyLock 保证多线程只算一次、结果可见。 */
    std::thread::spawn(|| {
        std::env::set_var("PATH", resolve::enriched_path());
    });
    session::ensure_config_dir().ok();
    let sessions = session::SessionRegistry::default();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
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
        })
        .invoke_handler(tauri::generate_handler![
            platform_kind,
            app_restart,
            cli_probe,
            cli_install_run,
            session_spawn,
            session_list,
            session_write,
            session_resize,
            session_kill,
            session_log_size,
            session_history_page,
            fs_list_dir,
            fs_read_file,
            fs_write_temp,
            fs_collect_files,
            fs_read_head,
            fs_read_tail,
            read_local_image_data_url,
            git_status,
            quota::quota_fetch,
            quota::quota_env_value,
            omp_auth::omp_auth_credential,
            omp_auth::omp_auth_providers,
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
