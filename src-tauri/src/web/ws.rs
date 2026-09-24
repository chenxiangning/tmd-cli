//! WS 命令桥:握手双凭据(URL token / 设备配对凭据)+ 连接生命周期。
//! 设备连接:hello 带 capabilities,5s 复查批准态(撤销即 4001),订阅过 event_allowed 域闸;
//! 浏览器 = 全量命令 + 全量事件(旧页不发 subscribe → 首帧前直通全发,新页 open 即重放订阅)。

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
    /// 真实设备名(壳拨号携带):桌面设备行随之自愈更新。
    name: Option<String>,
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
            match devices::find_by_credentials(&devices::devices_dir(), device_id, token) {
                Some(d) if d.approved => {
                    /* 名字自愈:壳上报系统设备名与存量行不同则更新(老配对全叫 iPhone)。 */
                    if let Some(name) = q.name.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
                        if d.name != name {
                            devices::set_name(&devices::devices_dir(), device_id, name);
                        }
                    }
                    ConnScope::AppDevice {
                        device_id: device_id.clone(),
                    }
                }
                Some(_) => return ws.on_upgrade(move |s| reject_socket(s, "pending")),
                None => return ws.on_upgrade(move |s| reject_socket(s, "rejected")),
            }
        }
        (None, Some(token)) if gate::token_ok(Some(token), &ctx.token) => ConnScope::Browser,
        _ => return StatusCode::FORBIDDEN.into_response(),
    };
    ws.on_upgrade(move |socket| handle_socket(ctx, socket, scope))
}

/// 未过闸的连接:bye + 4001 Close 后收线。
async fn reject_socket(socket: WebSocket, reason: &'static str) {
    let (mut tx, mut rx) = socket.split();
    /* bye 先行:close code 无法穿越 relay 中继流(管道丢弃 Close),语义必须带内传 */
    let _ = tx
        .send(Message::Text(
            json!({ "type": "bye", "reason": reason })
                .to_string()
                .into(),
        ))
        .await;
    let _ = tx
        .send(Message::Close(Some(CloseFrame {
            code: 4001,
            reason: reason.into(),
        })))
        .await;
    /* 立即 drop 会向对端发 RST,内核把未读缓冲(含 bye)一并丢弃 ——
     * iOS 壳的 URLSession 隧道读不到 close code,bye 被丢 = 永远不知道被拒。
     * 留 500ms 让对端读净再收线。 */
    let _ = tokio::time::timeout(std::time::Duration::from_millis(500), rx.next()).await;
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Inbound {
    Invoke {
        id: Value,
        cmd: String,
        #[serde(default)]
        args: Value,
    },
    /// 事件订阅:连接只收订阅过的事件(pty://out/* 等高频流不再无差别广播)。
    Subscribe {
        event: String,
    },
    Unsubscribe {
        event: String,
    },
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
    // 事件订阅集:未订阅的事件不发(慢链路手机不再被 pty out 高频流灌爆)。
    let mut subs: std::collections::HashSet<String> = std::collections::HashSet::new();
    /* 旧客户端兼容(契约评审 face2):22a493c 前页面不发 subscribe 帧 → 首帧到达前
       全发(旧语义),置位后收紧(新语义)。新客户端 open 即重放订阅,空窗毫秒级。 */
    let mut ever_subscribed = false;
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
                Ok(m) => {
                    /* 旧客户端兼容(契约评审 face2):22a493c 前浏览器页从不发 subscribe
                       → 首帧前全发(旧语义);新客户端 open 即重放订阅,空窗毫秒级。
                       设备域不适用(配对协议与订阅闸同批,必发 subscribe)。 */
                    let legacy = matches!(scope, conn::ConnScope::Browser) && !ever_subscribed;
                    if (legacy || event_subscribed(&m, &subs))
                        && ws_tx.send(Message::Text(m.into())).await.is_err()
                    {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            },
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let Ok(req) = serde_json::from_str::<Inbound>(&text) else { continue };
                        match req {
                            Inbound::Invoke { id, cmd, args } => {
                                let app = ctx.app.clone();
                                let scope = scope.clone();
                                let out = out_tx.clone();
                                tokio::spawn(async move {
                                    let frame = match conn::dispatch_scoped(&app, &scope, &cmd, args).await {
                                        Ok(payload) => serde_json::json!({"type": "response", "id": id, "ok": true, "payload": payload}),
                                        Err(error) => serde_json::json!({"type": "response", "id": id, "ok": false, "error": error}),
                                    };
                                    let _ = out.send(frame.to_string()).await;
                                });
                            }
                            Inbound::Subscribe { event } => {
                                ever_subscribed = true;
                                /* 设备域订阅闸(红队链3):命令域白名单在事件面的镜像——
                                   否则订 ssh:// / lsp:// / web://pair-alert 直接旁路域闸。
                                   设备面事件 = 会话实况/生命周期 + settings:changed(覆盖层同步)。 */
                                let ok = match &scope {
                                    conn::ConnScope::AppDevice { .. } => {
                                        conn::event_allowed(&event) && subs.len() < 256
                                    }
                                    conn::ConnScope::Browser => true,
                                };
                                if ok {
                                    subs.insert(event);
                                } else {
                                    /* 评审 F2:拒绝必回执,客户端清乐观位(否则本连接内
                                       该事件静默永久缺席,重连也不重订)。try_send:出站队列满
                                       时丢回执可接受(客户端 open 重放兜底)。 */
                                    let _ = out_tx.try_send(
                                        json!({"type": "subscribe-rejected", "event": event}).to_string(),
                                    );
                                }
                            }
                            Inbound::Unsubscribe { event } => {
                                subs.remove(&event);
                            }
                        }
                    }
                    /* Ping/Pong 由 tungstenite 自答;Binary/Close 不消费。 */
                    Some(Ok(_)) => {}
                    Some(Err(_)) | None => break,
                }
            }
            /* 撤销即时踢:bye 带内传语义(close code 过不了中继) */
            _ = kick_tick(&mut kick_rx) => {
                let _ = ws_tx.send(Message::Text(
                    json!({ "type": "bye", "reason": "revoked" }).to_string().into(),
                )).await;
                let frame = CloseFrame { code: 4001, reason: "revoked".into() };
                let _ = ws_tx.send(Message::Close(Some(frame))).await;
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                break;
            }
            /* 5s 批准态复查(interval 首跳即到 = 连上即查一次);浏览器连接永挂 */
            _ = recheck_tick(&scope, &mut recheck) => {
                if let ConnScope::AppDevice { device_id } = &scope {
                    if !devices::is_approved(&devices::devices_dir(), device_id) {
                        let _ = ws_tx.send(Message::Text(
                            json!({ "type": "bye", "reason": "revoked" }).to_string().into(),
                        )).await;
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
/// 事件帧是否该发往本连接:非 event 帧直通;event 帧只发订阅过的。
fn event_subscribed(frame: &str, subs: &std::collections::HashSet<String>) -> bool {
    let Ok(v) = serde_json::from_str::<Value>(frame) else {
        return true;
    };
    if v.get("type").and_then(Value::as_str) != Some("event") {
        return true;
    }
    v.get("event")
        .and_then(Value::as_str)
        .is_some_and(|name| subs.contains(name))
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
