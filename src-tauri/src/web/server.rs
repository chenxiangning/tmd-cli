//! Web 桥 HTTP/WS 服务:静态前端 + /ws 命令桥 + /file 资源路由 + CSP。
//! 协议(与 src/kernel/transport.ts 对齐):
//! - 客户端 → 桥:{"type":"invoke","id":N,"cmd":"…","args":{…}}
//! - 桥 → 客户端:hello 帧 {"type":"hello","version"};响应 {"type":"response","id","ok","payload"|"error"};
//!   事件帧 {"type":"event","event","payload"}(event_sink 广播)。

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State as AxumState,
    },
    http::{header, HeaderValue, StatusCode, Uri},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::{broadcast, oneshot, watch};

use super::{
    dispatch, file, gate,
    state::{RemoteSocket, WebAccessInfo},
};

/// Web 表面 CSP:无 Tauri 注入,桥自发;WS 仅允许同 origin。
const CSP: &str = "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self'; font-src 'self' data:; connect-src 'self' ws: wss:";

#[derive(Clone)]
pub(super) struct WebCtx {
    app: AppHandle,
    pub(super) token: Arc<String>,
    stop: watch::Sender<bool>,
}

/// 起服务:绑 0.0.0.0 随机端口(LAN 可达),返回(info, 停 accept, 停连接)。
pub(super) async fn serve(
    app: AppHandle,
) -> Result<(WebAccessInfo, oneshot::Sender<()>, watch::Sender<bool>), String> {
    let token = gate::new_token();
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::UNSPECIFIED, 0))
        .await
        .map_err(|e| format!("Web 桥端口绑定失败: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Web 桥取端口失败: {e}"))?
        .port();
    let lan_ip = lan_ip().unwrap_or_else(|| "127.0.0.1".to_string());
    let url = format!("http://{lan_ip}:{port}/?token={token}");
    eprintln!("[web-bridge] LAN: {url}");
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let (stop_watch, _) = watch::channel(false);
    let ctx = WebCtx {
        app,
        token: Arc::new(token.clone()),
        stop: stop_watch.clone(),
    };
    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, build_router(ctx))
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await;
    });
    Ok((
        WebAccessInfo {
            url,
            port,
            token,
            lan_ip,
        },
        shutdown_tx,
        stop_watch,
    ))
}

fn build_router(ctx: WebCtx) -> Router {
    Router::new()
        .route("/ws", get(ws_handler))
        .route("/file", get(file::file_handler))
        .fallback(static_handler)
        .layer(middleware::from_fn(csp))
        .with_state(ctx)
}

async fn csp(req: axum::extract::Request, next: Next) -> Response {
    let mut resp = next.run(req).await;
    resp.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(CSP),
    );
    resp
}

// ==================== /ws 命令桥 ====================

#[derive(Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

async fn ws_handler(
    AxumState(ctx): AxumState<WebCtx>,
    Query(q): Query<TokenQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    if !gate::token_ok(q.token.as_deref(), &ctx.token) {
        return StatusCode::FORBIDDEN.into_response();
    }
    ws.on_upgrade(move |socket| handle_socket(ctx, socket))
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

async fn handle_socket(ctx: WebCtx, socket: WebSocket) {
    /* 计数到 socket 真正结束:徽标语义 = 有浏览器在驾驶,与连接保活一致。 */
    let _remote = RemoteSocket::enter(ctx.app.clone());
    let (mut ws_tx, mut ws_rx) = socket.split();
    let hello =
        serde_json::json!({"type": "hello", "version": env!("CARGO_PKG_VERSION")}).to_string();
    if ws_tx.send(Message::Text(hello.into())).await.is_err() {
        return;
    }
    /* 出站:invoke 响应(mpsc)+ 事件广播(broadcast)合并进同一条 socket。 */
    let (out_tx, mut out_rx) = tokio::sync::mpsc::channel::<String>(256);
    let mut events_rx = crate::event_sink::subscribe();
    let mut stop_writer = ctx.stop.subscribe();
    tokio::spawn(async move {
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
                _ = stop_writer.changed() => break,
                else => {
                    /* 停机早于订阅:初始值已 true,changed() 永不再触发。 */
                    if *stop_writer.borrow() { break; }
                }
            }
        }
    });
    /* 入站:每个 invoke 独立 task —— 长命令(session_spawn 等)不阻塞读循环。 */
    let mut stop_reader = ctx.stop.subscribe();
    loop {
        tokio::select! {
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let Ok(req) = serde_json::from_str::<InvokeReq>(&text) else { continue };
                        if req.kind != "invoke" { continue; }
                        let app = ctx.app.clone();
                        let out = out_tx.clone();
                        tokio::spawn(async move {
                            let frame = match dispatch::dispatch(&app, &req.cmd, req.args).await {
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
            _ = stop_reader.changed() => break,
            else => {
                if *stop_reader.borrow() { break; }
            }
        }
    }
}

// ==================== 静态前端 ====================

/// 静态资源放行(token 只守数据面 /ws 与 /file;空壳 HTML/JS 无敏感)。
async fn static_handler(AxumState(ctx): AxumState<WebCtx>, uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let rel = if path.is_empty() { "index.html" } else { path };
    if let Some((bytes, mime)) = load_static(&ctx.app, rel) {
        return (StatusCode::OK, [(header::CONTENT_TYPE, mime)], bytes).into_response();
    }
    /* SPA 回退:无扩展名的路由路径回 index.html。 */
    if !rel.contains('.') {
        if let Some((bytes, mime)) = load_static(&ctx.app, "index.html") {
            return (StatusCode::OK, [(header::CONTENT_TYPE, mime)], bytes).into_response();
        }
    }
    (StatusCode::NOT_FOUND, "前端资源缺失(先 pnpm build)").into_response()
}

/// AssetResolver::get 注释明示:内嵌 miss 时回落读 frontendDist 目录(dev 行为与
/// webview 一致),故无需自管 dist 路径;mime_type 随资产自带,content_type 表也省。
fn load_static(app: &AppHandle, rel: &str) -> Option<(Vec<u8>, String)> {
    if rel.split('/').any(|seg| seg == "..") {
        return None;
    }
    app.asset_resolver()
        .get(rel.to_string())
        .map(|a| (a.bytes, a.mime_type))
}

/// 最佳努力的 LAN 地址:UDP connect 选路法(不真发包)。
/// ponytail: 只认默认路由出口;多网卡/VPN 叠加可能选错 —— 排除 ClashX
/// 增强模式假网段(198.18.0.0/15)后拿不到就回落 127.0.0.1,不引网卡枚举依赖。
pub(super) fn lan_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind((std::net::Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket
        .connect((std::net::Ipv4Addr::new(192, 0, 2, 1), 80))
        .ok()?;
    let std::net::IpAddr::V4(v4) = socket.local_addr().ok()?.ip() else {
        return None;
    };
    if !v4.is_private() {
        return None;
    }
    let o = v4.octets();
    if o[0] == 198 && (o[1] & 0xFE) == 18 {
        return None;
    }
    Some(v4.to_string())
}
