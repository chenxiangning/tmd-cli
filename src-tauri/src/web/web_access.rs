//! Web 访问开关命令:start/stop/status + 设置变化时的 autostart/关停。

use serde_json::json;
use tauri::{AppHandle, Manager};

use super::{devices, pair, server, state};

/// 设置里的 Web 访问开关(M1 仅内网;settings.ts 同步增加 webAccessEnabled 字段)。
pub(crate) fn web_enabled(settings: &serde_json::Value) -> bool {
    settings
        .get("webAccessEnabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

fn web_state(app: &AppHandle) -> tauri::State<'_, crate::AppState> {
    app.state::<crate::AppState>()
}

fn emit_info(app: &AppHandle) {
    let info = web_state(app).inner().web.status();
    crate::event_sink::emit(app, "web://access", &json!({ "info": info }));
}

#[tauri::command]
pub(crate) async fn web_access_start(
    app: AppHandle,
) -> Result<Option<state::WebAccessInfo>, String> {
    let state = web_state(&app);
    let web = &state.inner().web;
    let _guard = web.start_locked().await?;
    if let Some(info) = web.current() {
        return Ok(Some(info));
    }
    let (info, shutdown, stopped) = server::serve(app.clone()).await?;
    let info = web.publish(state::new_running(info, shutdown, stopped));
    emit_info(&app);
    Ok(Some(info))
}

#[tauri::command]
pub(crate) async fn web_access_stop(app: AppHandle) -> Result<(), String> {
    let state = web_state(&app);
    let web = &state.inner().web;
    let _guard = web.start_locked().await?;
    web.stop_running()?;
    emit_info(&app);
    Ok(())
}

#[tauri::command]
pub(crate) fn web_access_status(app: AppHandle) -> Option<state::WebAccessInfo> {
    web_state(&app).inner().web.status()
}

/// 设置变化跟随:开 → 起桥;关 → 停桥(lib.rs config_write_settings 同步调)。
pub(crate) fn apply_settings(app: &AppHandle, settings: &serde_json::Value) {
    let app = app.clone();
    let on = web_enabled(settings);
    tauri::async_runtime::spawn(async move {
        let r = if on {
            web_access_start(app.clone()).await.map(|_| ())
        } else {
            web_access_stop(app.clone()).await
        };
        if let Err(error) = r {
            crate::event_sink::emit(
                &app,
                "web://access",
                &json!({ "info": null, "error": error }),
            );
        }
    });
}

/// 应用启动时的 autostart(lib.rs setup 调;设置未开 = 空转)。
pub(crate) fn autostart(app: &AppHandle) {
    apply_settings(app, &crate::settings::load_settings());
}

/// 「有浏览器在驾驶」计数查询(徽标轮询;M1 = 全部 /ws 连接数)。
#[tauri::command]
pub(crate) fn remote_control_active() -> u64 {
    state::remote_socket_count()
}

// ==================== 设备配对命令面(desktop-only,不进 web dispatch) ====================

fn emit_devices(app: &AppHandle) {
    crate::event_sink::emit(app, "web://devices", &json!({}));
}

/// 铸一次性配对 offer(桥须在运行):tmd://pair 短链 + 码 + 过期 unix 秒。
#[tauri::command]
pub(crate) fn web_pair_offer(app: AppHandle) -> Result<serde_json::Value, String> {
    let (url, code, expires_at) = pair::mint_offer(&app)?;
    Ok(json!({ "url": url, "pairCode": code, "expiresAt": expires_at }))
}

/// 设备表(脱敏:token hash 不出桌面)。
#[tauri::command]
pub(crate) fn web_devices_list() -> serde_json::Value {
    let dir = devices::devices_dir();
    let now = devices::now_secs();
    let rows: Vec<serde_json::Value> = devices::load_devices(&dir)
        .iter()
        .map(|d| {
            json!({
                "deviceId": d.device_id,
                "name": d.name,
                "createdAt": d.created_at,
                "lastSeenAt": d.last_seen_at,
                "approved": d.approved,
            })
        })
        .collect();
    json!({ "devices": rows, "now": now })
}

/// 批准 pending 设备;存在与否都回写列表事件。
#[tauri::command]
pub(crate) fn web_device_approve(app: AppHandle, device_id: String) -> bool {
    let ok = devices::approve(&devices::devices_dir(), &device_id, devices::now_secs());
    emit_devices(&app);
    ok
}

/// 撤销设备(删行 + 踢既有连接);返回是否真的删了。
#[tauri::command]
pub(crate) fn web_device_revoke(app: AppHandle, device_id: String) -> bool {
    let ok = devices::revoke(&devices::devices_dir(), &device_id);
    emit_devices(&app);
    ok
}
