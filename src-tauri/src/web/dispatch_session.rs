//! session/checkpoint 域命令桥。命令名与参数键逐一对齐 kernel/ipc.ts 的 invoke 调用。
//! file-size-exempt:单 match 臂表 = 命令面清单,与 ipc.ts 同构集中(R3 的 WS 侧镜像);
//! 每条臂仅参数解包 + 委托,拆分反而切断「加命令 = 加一臂」的维护闭包。

use std::future::Future;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use super::dispatch::{args, block, ser, val};

/// 本域闸表:session 与 checkpoint 两域的全部桥面命令名。与 dispatch_inner 臂表同文件
/// 维护;conn.rs 交叉测试钉「AppDevice 白名单 session/checkpoint 域 ⊆ 本表」防漂移
/// (2026-09-24 link_log 被顶出闸表的回归教训)。
pub(super) const GATED: &[&str] = &[
    "session_spawn",
    "session_list",
    "session_set_workspace",
    "session_write",
    "session_resize",
    "session_kill",
    "session_log_size",
    "session_size",
    "session_history_page",
    "session_link_log",
    "session_bind_cli",
    "session_pin_toggle",
    "session_disk_tail",
    "checkpoint_anchor",
    "checkpoint_record_edit",
    "checkpoint_apply",
    "checkpoint_seal",
    "checkpoint_seal_dead",
    "checkpoint_list",
    "checkpoint_batch_diff",
    "checkpoint_restore",
    "checkpoint_approve",
    "checkpoint_undo_revert",
    "checkpoint_prune",
];

pub(super) async fn try_dispatch(
    app: &AppHandle,
    cmd: &str,
    raw: &Value,
) -> Option<Result<Value, String>> {
    if !GATED.contains(&cmd) {
        return None;
    }
    Some(dispatch_inner(app, cmd, raw).await)
}

async fn dispatch_inner(app: &AppHandle, cmd: &str, raw: &Value) -> Result<Value, String> {
    match cmd {
        "session_spawn" => spawn(app, raw).await,
        "session_bind_cli" => {
            let a = args::<BindCliArgs>(raw)?;
            ser(crate::session_commands::session_bind_cli(
                app.state(),
                a.id,
                a.cli_session_id,
            ))
        }
        "session_pin_toggle" => {
            let a = args::<PinToggleArgs>(raw)?;
            /* 整棵 settings.json 读+写 = 磁盘 IO,走 block() 纪律(评审 F4)。 */
            let r = block(move || {
                let now_pinned = crate::settings::toggle_pin(&a.key, &a.title)?;
                Ok(serde_json::json!({ "pinned": now_pinned }))
            })
            .await?;
            /* 与 config_merge_settings 同款纪律:广播回读,桌面置顶区即时更新 */
            let _ = crate::event_sink::emit(app, "settings:changed", &serde_json::json!({}));
            Ok(r)
        }
        "session_list" => val(crate::session_commands::session_list(app.state())),
        "session_set_workspace" => ser(crate::session_commands::session_set_workspace(
            app.state(),
            args::<IdArgs>(raw)?.id,
            args::<IdArgs>(raw)?.workspace_id,
        )),
        "session_write" => {
            let a = args::<WriteArgs>(raw)?;
            let r = crate::session_commands::session_write(app.clone(), a.id.clone(), a.data).await;
            /* 桥写绕过桌面 writeSession → ActivityWatch 锚定/Ask 清除全失明
            (桌面行无状态签,手机/桌面两边不同步,2026-09-24 实证)。
            成功即广播,桌面 noteRemoteWrite 补锚定(语义见 hostSessionServices)。 */
            if r.is_ok() {
                let _ = crate::event_sink::emit(
                    app,
                    "session:remote-write",
                    &serde_json::json!({ "sessionId": a.id }),
                );
            }
            ser(r)
        }
        "session_resize" => {
            let a = args::<ResizeArgs>(raw)?;
            ser(crate::session_commands::session_resize(
                app.state(),
                a.id,
                a.cols,
                a.rows,
            ))
        }
        "session_kill" => {
            ser(crate::session_commands::session_kill(app.clone(), args::<IdArgs>(raw)?.id).await)
        }
        "session_log_size" => val(crate::session_commands::session_log_size(
            app.state(),
            args::<IdArgs>(raw)?.id,
        )),
        "session_size" => val(crate::session_commands::session_size(
            app.state(),
            args::<IdArgs>(raw)?.id,
        )),
        "session_history_page" => {
            let a = args::<HistoryArgs>(raw)?;
            ser(crate::session_commands::session_history_page(
                app.clone(),
                a.id,
                a.before,
                a.max_bytes,
            )
            .await)
        }
        "session_link_log" => {
            let a = args::<LinkLogArgs>(raw)?;
            ser(crate::session_commands::session_link_log(
                a.profile_id,
                a.cwd,
                a.cli_session_id,
                a.log_id,
            ))
        }
        "session_disk_tail" => {
            let a = args::<DiskTailArgs>(raw)?;
            ser(crate::session_commands::session_disk_tail(
                a.profile_id,
                a.cwd,
                a.cli_session_id,
                a.max_bytes,
            )
            .await)
        }
        "checkpoint_anchor" => {
            go(raw, |a: AnchorArgs| {
                crate::checkpoints::commands::checkpoint_anchor(
                    a.cwd,
                    a.session_id,
                    a.tmd_session_id,
                    a.prompt,
                    a.engine,
                    a.model,
                    a.thinking,
                    a.attribution,
                )
            })
            .await
        }
        "checkpoint_record_edit" => {
            go(raw, |a: RecordArgs| {
                crate::checkpoints::commands::checkpoint_record_edit(
                    a.cwd,
                    a.session_id,
                    a.tmd_session_id,
                    a.path,
                    a.ts,
                )
            })
            .await
        }
        "checkpoint_apply" => {
            go(raw, |a: BatchPaths| {
                crate::checkpoints::commands::checkpoint_apply(a.cwd, a.batch_id, a.paths)
            })
            .await
        }
        "checkpoint_seal" => {
            go(raw, |a: SealArgs| {
                crate::checkpoints::commands::checkpoint_seal(a.cwd, a.session_id, a.tmd_session_id)
            })
            .await
        }
        "checkpoint_seal_dead" => {
            go(raw, |a: SealDead| {
                crate::checkpoints::commands::checkpoint_seal_dead(a.cwd, a.grace_ms)
            })
            .await
        }
        "checkpoint_list" => {
            go(raw, |a: SealArgs| {
                crate::checkpoints::commands::checkpoint_list(a.cwd, a.session_id, a.tmd_session_id)
            })
            .await
        }
        "checkpoint_batch_diff" => {
            go(raw, |a: BatchArgs| {
                crate::checkpoints::commands::checkpoint_batch_diff(a.cwd, a.batch_id)
            })
            .await
        }
        "checkpoint_restore" => {
            go(raw, |a: BatchPaths| {
                crate::checkpoints::commands::checkpoint_restore(a.cwd, a.batch_id, a.paths)
            })
            .await
        }
        "checkpoint_approve" => {
            go(raw, |a: BatchArgs| {
                crate::checkpoints::commands::checkpoint_approve(a.cwd, a.batch_id)
            })
            .await
        }
        "checkpoint_undo_revert" => {
            go(raw, |a: BatchArgs| {
                crate::checkpoints::commands::checkpoint_undo_revert(a.cwd, a.batch_id)
            })
            .await
        }
        "checkpoint_prune" => {
            go(raw, |a: PruneArgs| {
                crate::checkpoints::commands::checkpoint_prune(a.cwd, a.keep, a.ttl_days)
            })
            .await
        }
        _ => Err(format!("internal: gated command without arm: {cmd}")), /* 评审 F5:漂移不 panic(spawn 任务里 unreachable = response 永挂) */
    }
}

async fn go<A: serde::de::DeserializeOwned, T, F, Fut>(raw: &Value, f: F) -> Result<Value, String>
where
    F: FnOnce(A) -> Fut,
    Fut: Future<Output = Result<T, String>>,
    T: serde::Serialize,
{
    ser(f(args::<A>(raw)?).await)
}

async fn spawn(app: &AppHandle, raw: &Value) -> Result<Value, String> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SpawnArgs {
        profile_id: String,
        spec: crate::pty::SpawnSpec,
        workspace_id: Option<String>,
        /// CLI 磁盘身份(手机续接老会话自带;注册表直填,桌面装配不再猜)。
        #[serde(default)]
        cli_session_id: Option<String>,
    }
    let a = args::<SpawnArgs>(raw)?;
    let spawned = crate::session_commands::session_spawn(
        app.clone(),
        a.profile_id.clone(),
        a.spec,
        a.workspace_id,
        a.cli_session_id.clone(),
    )
    .await?;
    /* 桥发起 = 绕过桌面前端装配(身份绑定/常驻订阅/状态守望全缺,桌面行退化成
    短码标题+无运行态)。广播请桌面 host 走 adoptPtySession 补全装配
    (activate:false 不抢前台;语义见 kernel/sessionAdopt.ts)。 */
    let _ = crate::event_sink::emit(
        app,
        "session:external-spawn",
        &serde_json::json!({
            "sessionId": spawned.id,
            "profileId": a.profile_id,
            "cliSessionId": a.cli_session_id,
        }),
    );
    val(spawned)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdArgs {
    id: String,
    #[serde(default)]
    workspace_id: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BindCliArgs {
    id: String,
    cli_session_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PinToggleArgs {
    key: String,
    #[serde(default)]
    title: String,
}

#[derive(serde::Deserialize)]
struct WriteArgs {
    id: String,
    data: String,
}

#[derive(serde::Deserialize)]
struct ResizeArgs {
    id: String,
    cols: u16,
    rows: u16,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryArgs {
    id: String,
    before: u64,
    max_bytes: u64,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkLogArgs {
    profile_id: String,
    cwd: String,
    cli_session_id: String,
    log_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiskTailArgs {
    profile_id: String,
    cwd: String,
    cli_session_id: String,
    max_bytes: u64,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnchorArgs {
    cwd: String,
    session_id: String,
    tmd_session_id: String,
    prompt: String,
    engine: String,
    model: String,
    thinking: String,
    attribution: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecordArgs {
    cwd: String,
    session_id: String,
    tmd_session_id: String,
    path: String,
    ts: Option<i64>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SealArgs {
    cwd: String,
    session_id: String,
    tmd_session_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SealDead {
    cwd: String,
    grace_ms: i64,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchArgs {
    cwd: String,
    batch_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchPaths {
    cwd: String,
    batch_id: String,
    paths: Option<Vec<String>>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PruneArgs {
    cwd: String,
    keep: usize,
    ttl_days: u32,
}
