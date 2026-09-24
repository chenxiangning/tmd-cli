//! Web 桥 HTTP 服务:双监听(LAN + 同端口 loopback)+ 静态前端 + 路由装配 + CSP。
//! WS 命令桥在 ws.rs(握手双凭据/连接生命周期);配对 HTTP 面在 pair.rs。
//! 协议(与 src/kernel/transport.ts 对齐):
//! - 客户端 → 桥:{"type":"invoke","id":N,"cmd":"…","args":{…}}
//! - 桥 → 客户端:hello 帧 {"type":"hello","version","capabilities"};响应 {"type":"response","id","ok","payload"|"error"};事件帧 {"type":"event","event","payload"}(event_sink 广播)。

use axum::{
    extract::State as AxumState,
    http::{header, HeaderValue, StatusCode, Uri},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::{oneshot, watch};

use super::{bind, file, gate, pair, state::WebAccessInfo, ws};

/// Web 表面 CSP:无 Tauri 注入,桥自发;WS 仅允许同 origin。
const CSP: &str = "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self'; font-src 'self' data:; connect-src 'self' ws: wss:";

#[derive(Clone)]
pub(super) struct WebCtx {
    pub(super) app: AppHandle,
    pub(super) token: Arc<String>,
    pub(super) stop: watch::Sender<bool>,
}

/// 起服务:绑 LAN 接口 IP 随机端口,并同端口补绑 loopback(relay agent 回拨面)。
/// 返回(info, 停 accept, 停连接)。
pub(super) async fn serve(
    app: AppHandle,
) -> Result<(WebAccessInfo, oneshot::Sender<()>, watch::Sender<bool>), String> {
    let token = gate::new_token();
    /* 只绑解析出的 LAN 接口 IP(与展示 URL 同一来源):VPN tun / 容器网段 /
    公司 VPN 不再随 0.0.0.0 全接口可达;解析失败回落 127.0.0.1(仅本机)。
    同端口补绑 127.0.0.1:relay agent 每流按 loopback 回拨本机桥,单绑 LAN IP 会拒。 */
    let lan_ip = lan_ip().unwrap_or_else(|| "127.0.0.1".to_string());
    let (listener, loopback) = bind::bind_bridge(&lan_ip).await?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Web 桥取端口失败: {e}"))?
        .port();
    let url = format!("http://{lan_ip}:{port}/?token={token}");
    /* 不把含 token 的完整 URL 打进 stderr 日志(隐私)。 */
    eprintln!("[web-bridge] LAN: http://{lan_ip}:{port}/");
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let (stop_watch, _) = watch::channel(false);
    let ctx = WebCtx {
        app,
        token: Arc::new(token.clone()),
        stop: stop_watch.clone(),
    };
    /* oneshot 停机信号经 watch 转发,双 serve(LAN + loopback)共享同一停机。 */
    let (halt_tx, mut halt_rx) = watch::channel(false);
    tauri::async_runtime::spawn(async move {
        let _ = shutdown_rx.await;
        let _ = halt_tx.send(true);
    });
    /* ConnectInfo:pair_handler 按来源 IP 节流需要真实对端地址。 */
    let router = build_router(ctx).into_make_service_with_connect_info::<SocketAddr>();
    if let Some(lo) = loopback {
        let (svc, mut halt) = (router.clone(), halt_rx.clone());
        tauri::async_runtime::spawn(async move {
            let _ = axum::serve(lo, svc)
                .with_graceful_shutdown(async move {
                    let _ = halt.changed().await;
                })
                .await;
        });
    }
    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = halt_rx.changed().await;
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
        .route("/ws", get(ws::ws_handler))
        .route(
            "/pair",
            post(pair::pair_handler).options(pair::pair_preflight),
        )
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

// ==================== 静态前端 ====================

/// 静态资源放行(token 只守数据面 /ws 与 /file;空壳 HTML/JS 无敏感)。
async fn static_handler(AxumState(ctx): AxumState<WebCtx>, uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let rel = if path.is_empty() { "index.html" } else { path };
    if let Some((bytes, mime)) = load_static(&ctx.app, rel) {
        let mut resp = (StatusCode::OK, [(header::CONTENT_TYPE, mime)], bytes).into_response();
        /* index.html 必 no-cache:软刷新吃盘里旧壳 = 旧客户端连新服务端,订阅协议
           静默失效(契约评审 2026-09-24);assets 带 hash 名,留默认缓存。 */
        if rel.ends_with(".html") {
            resp.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
        }
        return resp;
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
