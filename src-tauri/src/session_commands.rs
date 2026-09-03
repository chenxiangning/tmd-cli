//! 会话命令(session_spawn/list/write/resize/kill/log/history)—— 自 lib.rs 拆件
//! (文件规模铁则;git/commands.rs 同款模板)。SSH 会话与 PTY 会话在此按 kind 路由。

use tauri::{AppHandle, Manager, State};

use crate::pty::{SpawnSpec, SpawnedSession};
use crate::session::SessionMeta;
use crate::{now_millis, session_log, ssh, AppState};

/// 必须 async + spawn_blocking:冷路径首个 spawn 会内联触发 PATH 富化
/// (login shell 最长 3s 硬超时),同步执行冻结主线程。
#[tauri::command]
pub async fn session_spawn(
    app: AppHandle,
    profile_id: String,
    spec: SpawnSpec,
    workspace_id: Option<String>,
) -> Result<SpawnedSession, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let cwd = spec.cwd.clone();
        let spawned = state.pty.spawn(&app, &profile_id, spec)?;
        state.sessions.register(SessionMeta {
            id: spawned.id.clone(),
            profile_id,
            cwd,
            workspace_id,
            created_at: now_millis(),
            pid: spawned.pid,
            kind: "cli".to_string(),
            title: None,
        });
        Ok(spawned)
    })
    .await
    .map_err(|e| format!("session_spawn join 失败: {e}"))?
}

#[tauri::command]
pub fn session_list(state: State<'_, AppState>) -> Vec<SessionMeta> {
    state.sessions.list()
}

/// 必须 async + spawn_blocking:PTY 写入在子进程停读时可无限阻塞,
/// 同步 command 跑在主线程会冻结整个 UI,且全局注册表锁连带卡死所有会话。
#[tauri::command]
pub async fn session_write(app: AppHandle, id: String, data: String) -> Result<(), String> {
    /* SSH 会话写输入是 try_send 快路径;PTY 写入会阻塞,维持 spawn_blocking。 */
    {
        let state = app.state::<AppState>();
        if state.ssh.contains(&id) {
            return ssh::control::write_input(&state.ssh, &id, &data);
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state.pty.write(&id, &data)
    })
    .await
    .map_err(|e| format!("session_write join 失败: {e}"))?
}

#[tauri::command]
pub fn session_resize(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    /* 按 kind 路由:SSH 走 russh 引擎(未连接时记尺寸,连接后生效)。 */
    if state.ssh.contains(&id) {
        return ssh::control::resize(&state.ssh, &id, cols, rows);
    }
    state.pty.resize(&id, cols, rows)
}

/// kill 涉及子进程回收,与写路径同纪律:spawn_blocking,不占主线程。
#[tauri::command]
pub async fn session_kill(app: AppHandle, id: String) -> Result<(), String> {
    /* SSH:标记关闭 + 级联(转发/SFTP/日志)+ pty://exit,同步收尾。 */
    {
        let state = app.state::<AppState>();
        if state.ssh.contains(&id) {
            state.sessions.remove(&id);
            return ssh::control::kill(&app, &state.ssh, &id);
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state.sessions.remove(&id);
        state.pty.kill(&id)
    })
    .await
    .map_err(|e| format!("session_kill join 失败: {e}"))?
}

/// 会话输出日志的绝对末尾偏移;无日志返回 0。
#[tauri::command]
pub fn session_log_size(state: State<'_, AppState>, id: String) -> u64 {
    state
        .pty
        .session_log_end(&id)
        .or_else(|| {
            state
                .ssh
                .logs
                .lock()
                .get(&id)
                .map(|meta| meta.written + meta.base)
        })
        .unwrap_or(0)
}

/// 幕布往前翻页:磁盘读,spawn_blocking 与其余 fs 命令同纪律。
#[tauri::command]
pub async fn session_history_page(
    app: AppHandle,
    id: String,
    before: u64,
    max_bytes: u64,
) -> Result<session_log::HistoryPage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        if state.ssh.contains(&id) {
            let (path, base, written) = {
                let logs = state.ssh.logs.lock();
                let meta = logs.get(&id).ok_or("SSH 会话日志不存在")?;
                (meta.path.clone(), meta.base, meta.written)
            };
            return session_log::read_history_page(&path, base, written, before, max_bytes);
        }
        state.pty.session_history_page(&id, before, max_bytes)
    })
    .await
    .map_err(|e| format!("session_history_page join 失败: {e}"))?
}
