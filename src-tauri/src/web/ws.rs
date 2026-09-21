//! WS 命令桥:握手双凭据(URL token / 设备配对凭据)+ 连接生命周期。
//! 设备连接:hello 带 capabilities,5s 复查批准态(撤销即 4001);浏览器全量不变。

use axum::{
    extract::{
        ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
        Query, State as AxumState,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::broadcast;

use super::{
    conn::{self, ConnScope},
    devices, gate,
    server::WebCtx,
    state::RemoteSocket,
};

#[derive(Deserialize)]
pub(super) struct TokenQuery {
    token: Option<String>,
    device: Option<String>,
}

/// 握手闸:浏览器 ?token=;设备 ?device=&token=(哈希比对 + 已批准)。
/// pending/被撤照常升级后立即 4001 + reason,壳据此区分「待批准」与「已被撤销」。
pub(super) async fn ws_handler(
    AxumState(ctx): AxumState<WebCtx>,
    Query(q): Query<TokenQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    let scope = match (&q.device, &q.token) {
        (Some(device_id), Some(token)) => {
            match devices::validate(&devices::devices_dir(), device_id, token) {
                Some(d) if d.approved => ConnScope::AppDevice {
                    device_id: device_id.clone(),
                },
                Some(_) => return ws.on_upgrade(move |s| reject_socket(s, "pending")),
                None => return ws.on_upgrade(move |s| reject_socket(s, "rejected")),
            }
        }
        (None, Some(token)) if gate::token_ok(Some(token), &ctx.token) => ConnScope::Browser,
        _ => return StatusCode::FORBIDDEN.into_response(),
    };
    ws.on_upgrade(move |socket| handle_socket(ctx, socket, scope))
}

/// 未过闸的连接:发 4001 Close 帧即收线。
async fn reject_socket(socket: WebSocket, reason: &'static str) {
    let (mut tx, _rx) = socket.split();
    let _ = tx
        .send(Message::Close(Some(CloseFrame {
            code: 4001,
            reason: reason.into(),
        })))
        .await;
}

#[derive(Deserialize)]
struct InvokeReq {
    #[serde(rename = "type")]
    kind: String,
    id: Value,
    cmd: String,
    #[serde(default)]
    args: Value,
}

async fn handle_socket(ctx: WebCtx, socket: WebSocket, scope: ConnScope) {
    /* 计数到 socket 真正结束:徽标语义 = 有浏览器在驾驶,与连接保活一致。 */
    let _remote = RemoteSocket::enter(ctx.app.clone());
    if let ConnScope::AppDevice { device_id } = &scope {
        devices::touch_last_seen(&devices::devices_dir(), device_id, devices::now_secs());
    }
    /* 设备连接登记:桌面撤销即时踢(不等 5s 复查)。 */
    let (_live, live_rx) = if let ConnScope::AppDevice { device_id } = &scope {
        let (guard, rx) = conn::register_live(device_id);
        (Some(guard), Some(rx))
    } else {
        (None, None)
    };
    let (mut ws_tx, mut ws_rx) = socket.split();
    let hello = json!({
        "type": "hello",
        "version": env!("CARGO_PKG_VERSION"),
        "capabilities": [scope.capability()],
    });
    if ws_tx
        .send(Message::Text(hello.to_string().into()))
        .await
        .is_err()
    {
        return;
    }
    /* 出站:invoke 响应(mpsc)+ 事件广播(broadcast)合并进同一条 socket。
    收发同循环:任一收线分支都能先发 Close 帧再统一断开,避免半边 drop
    把 4001 竞态成 1006。 */
    let (out_tx, mut out_rx) = tokio::sync::mpsc::channel::<String>(256);
    let mut events_rx = crate::event_sink::subscribe();
    let mut stop = ctx.stop.subscribe();
    /* 订阅后立即吸收已置位(stop 早于本连接):否则 watch 语义下 changed() 不再
    触发,socket 将带着完整派发权活到自行断连。 */
    if *stop.borrow_and_update() {
        return;
    }
    /* 设备撤销信号(桌面 revoke → conn::kick 置位)。 */
    let mut kick_rx = live_rx;
    let mut recheck = tokio::time::interval(std::time::Duration::from_secs(5));
    loop {
        tokio::select! {
            msg = out_rx.recv() => match msg {
                Some(m) => if ws_tx.send(Message::Text(m.into())).await.is_err() { break },
                None => break,
            },
            ev = events_rx.recv() => match ev {
                Ok(m) => if ws_tx.send(Message::Text(m.into())).await.is_err() { break },
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            },
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let Ok(req) = serde_json::from_str::<InvokeReq>(&text) else { continue };
                        if req.kind != "invoke" { continue; }
                        let app = ctx.app.clone();
                        let scope = scope.clone();
                        let out = out_tx.clone();
                        tokio::spawn(async move {
                            let frame = match conn::dispatch_scoped(&app, &scope, &req.cmd, req.args).await {
                                Ok(payload) => serde_json::json!({"type": "response", "id": req.id, "ok": true, "payload": payload}),
                                Err(error) => serde_json::json!({"type": "response", "id": req.id, "ok": false, "error": error}),
                            };
                            let _ = out.send(frame.to_string()).await;
                        });
                    }
                    /* Ping/Pong 由 tungstenite 自答;Binary/Close 不消费。 */
                    Some(Ok(_)) => {}
                    Some(Err(_)) | None => break,
                }
            }
            /* 撤销即时踢 */
            _ = kick_tick(&mut kick_rx) => {
                let frame = CloseFrame { code: 4001, reason: "revoked".into() };
                let _ = ws_tx.send(Message::Close(Some(frame))).await;
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                break;
            }
            /* 5s 批准态复查(interval 首跳即到 = 连上即查一次);浏览器连接永挂 */
            _ = recheck_tick(&scope, &mut recheck) => {
                if let ConnScope::AppDevice { device_id } = &scope {
                    if !devices::is_approved(&devices::devices_dir(), device_id) {
                        let frame = CloseFrame { code: 4001, reason: "revoked".into() };
                        let _ = ws_tx.send(Message::Close(Some(frame))).await;
                        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                        break;
                    }
                }
            }
            _ = stop.changed() => break,
        }
    }
}

/// 浏览器连接无复查:永挂;设备连接 5s 一跳(interval 首跳即到 = 连上即查一次)。
async fn recheck_tick(scope: &ConnScope, iv: &mut tokio::time::Interval) {
    if let ConnScope::AppDevice { .. } = scope {
        iv.tick().await;
    } else {
        std::future::pending::<()>().await;
    }
}

/// 浏览器连接无踢通道:永挂;设备连接在撤销(revoke → kick)时被唤醒。
async fn kick_tick(rx: &mut Option<tokio::sync::watch::Receiver<()>>) {
    match rx {
        Some(r) => {
            let _ = r.changed().await;
        }
        None => std::future::pending::<()>().await,
    }
}
