//! 外网中继(agent 任务半):出站拨号、心跳保活、HTTP/WS 流多路复用。
//! relay.rs 只留状态与命令;本文件内纯异步逻辑可独立单测。

// file-size-exempt: relay 出站拨号+多路复用+部署,与 codemoss relay.rs 同源;拆分已做(state/core/agent 三件),再细即拆散同一条协议
use std::collections::HashMap;
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use tokio::net::TcpStream;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::client_async_tls_with_config;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::Connector;

use crate::ssh::proxy::{
    http_connect_proxy, socks5_connect_proxy, split_host_port, split_proxy_scheme,
    ResolvedSshProxy, SshProxyKind,
};

use super::relay_core::{
    b64_to_bytes, bytes_to_b64, hop_headers, queue_heartbeat, redial_until_connected, send,
    AgentFrame, ClientFrame, LiveSocket, OutFrame, PendingHttp, HEARTBEAT_INTERVAL,
    MAX_CLIENT_FRAME, MAX_HTTP_BODY, MAX_PENDING_STREAMS, PENDING_HTTP_TTL, REDIAL_DELAY_MS,
    VIA_HEADER,
};

/// 保持 agent socket 存活:活着又死就重拨;拨不上就封顶退避重试,只有开关能停。
pub(super) async fn run_agent(
    app: tauri::AppHandle,
    agent: String,
    port: u16,
    mut stop: watch::Receiver<bool>,
    generation: u64,
) {
    loop {
        if *stop.borrow() {
            return;
        }
        let connected = redial_until_connected(
            &mut stop,
            || {
                let agent = agent.clone();
                async move { dial_agent(&agent).await }
            },
            |attempt, error| {
                super::relay::set_connected(&app, generation, false);
                super::relay::set_error(
                    &app,
                    generation,
                    format!("连接中继失败,第 {attempt} 次重试: {error}"),
                );
            },
        )
        .await;
        let Some(socket) = connected else {
            return;
        };
        super::relay::set_error(&app, generation, String::new());
        super::relay::set_connected(&app, generation, true);
        /* dev 便捷:中继就绪后重出 offer(起桥时中继尚未连上,首份 relay=null;
        仅 debug 构建,release 零编译)。 */
        #[cfg(debug_assertions)]
        if let Ok((url, _, _)) = super::pair::mint_offer(&app) {
            eprintln!("[web-bridge] dev pairing offer (relay): {url}");
        }
        serve(socket, port, &mut stop).await;
        super::relay::set_connected(&app, generation, false);
        if *stop.borrow() {
            return;
        }
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_millis(REDIAL_DELAY_MS)) => {}
            _ = stop.changed() => return,
        }
    }
}

/// rustls 0.23 在树内同时含 aws-lc-rs(reqwest 启用)与 ring(webpki 拽入)两个
/// crypto provider 时,自动探测直接 panic;显式装与 reqwest 一致的 aws-lc-rs。
fn install_tls_provider() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    });
}
/// 出站拨号:tokio-tungstenite 不读 *_PROXY env,直连被墙时表现为整 20 秒连接超时
/// (deploy 走 reqwest 读 env 所以能成)。这里手工接管:先按进程 env 代理打通
/// TCP 隧道(HTTP CONNECT / SOCKS5,复用 ssh 握手),再在其上升 TLS + WS。
async fn dial_agent(agent: &str) -> Result<AgentSocket, String> {
    install_tls_provider();
    let request = agent
        .into_client_request()
        .map_err(|e| format!("中继地址无效: {e}"))?;
    let uri = request.uri().clone();
    let scheme = uri.scheme_str().unwrap_or("wss");
    let host = uri
        .host()
        .ok_or_else(|| "中继地址缺少主机名".to_string())?
        .to_string();
    let tls = matches!(scheme, "https" | "wss");
    let port = uri.port_u16().unwrap_or(if tls { 443 } else { 80 });
    let stream = connect_via_env_proxy(scheme, &host, port).await?;
    // 自建中继(443 自签证书):内置钉或 settings 动态钉命中才走钉住 verifier。
    let dynamic = super::pinned_tls::dynamic_pin();
    let pinned = tls
        && (host == super::pinned_tls::PINNED_HOST
            || dynamic.as_ref().is_some_and(|(h, _)| *h == host));
    let connector = pinned.then(|| {
        let extra = dynamic
            .as_ref()
            .map(|(h, der)| (h.as_str(), der.as_slice()));
        Connector::Rustls(super::pinned_tls::pinned_client_config_with(extra))
    });
    client_async_tls_with_config(request, stream, None, connector)
        .await
        .map(|(socket, _)| socket)
        .map_err(|e| e.to_string())
}

async fn connect_via_env_proxy(scheme: &str, host: &str, port: u16) -> Result<TcpStream, String> {
    let proxy = env_proxy_for(scheme, host);
    let mut stream = match &proxy {
        Some(proxy) => TcpStream::connect((proxy.host.as_str(), proxy.port))
            .await
            .map_err(|e| format!("代理 {}:{} 连接失败: {e}", proxy.host, proxy.port))?,
        None => TcpStream::connect((host, port))
            .await
            .map_err(|e| format!("TCP 连接 {host}:{port} 失败: {e}"))?,
    };
    if let Some(proxy) = &proxy {
        match proxy.kind {
            SshProxyKind::Http => http_connect_proxy(&mut stream, host, port, proxy).await?,
            SshProxyKind::Socks5 => socks5_connect_proxy(&mut stream, host, port, proxy).await?,
        }
    }
    let _ = stream.set_nodelay(true);
    Ok(stream)
}

/// 与 reqwest 同源:HTTPS_PROXY/ALL_PROXY(大小写两套)+ NO_PROXY。
fn env_proxy_for(scheme: &str, host: &str) -> Option<ResolvedSshProxy> {
    let no_proxy = first_env(&["NO_PROXY", "no_proxy"]).unwrap_or_default();
    if host_in_no_proxy(host, &no_proxy) {
        return None;
    }
    let keys: &[&str] = if matches!(scheme, "https" | "wss") {
        &["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]
    } else {
        &["HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]
    };
    first_env(keys).and_then(|raw| proxy_from_url(&raw))
}

fn first_env(keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|k| std::env::var(k).ok().map(|v| v.trim().to_string()))
        .filter(|v| !v.is_empty())
}

/// 解析 env 代理 URL;不认识的协议(如 socks4)回落直连而非报错。
fn proxy_from_url(raw: &str) -> Option<ResolvedSshProxy> {
    let (scheme, authority) = split_proxy_scheme(raw.trim());
    let kind = match scheme.unwrap_or("").to_ascii_lowercase().as_str() {
        "http" | "https" | "" => SshProxyKind::Http,
        "socks5" | "socks" | "socks5h" => SshProxyKind::Socks5,
        _ => return None,
    };
    let authority = authority.split(['/', '?', '#']).next().unwrap_or(authority);
    let (userinfo, hostpart) = authority.rsplit_once('@').unwrap_or(("", authority));
    let (host, port) = split_host_port(hostpart.trim());
    if host.is_empty() {
        return None;
    }
    let (username, password) = match userinfo.split_once(':') {
        Some((u, p)) => (u.to_string(), p.to_string()),
        None => (userinfo.to_string(), String::new()),
    };
    Some(ResolvedSshProxy {
        kind,
        host,
        port: port.unwrap_or(if kind == SshProxyKind::Socks5 {
            1080
        } else {
            8080
        }),
        username,
        password,
    })
}

// ponytail: NO_PROXY 只支持精确/后缀匹配(reqwest 还认通配段);够用,误判时删条目即绕开。
fn host_in_no_proxy(host: &str, list: &str) -> bool {
    let host = host.to_ascii_lowercase();
    list.split(',').any(|entry| {
        let entry = entry.trim().to_ascii_lowercase();
        if entry.is_empty() {
            return false;
        }
        if entry == "*" {
            return true;
        }
        if let Some(prefix) = entry.strip_suffix('*') {
            return host.starts_with(prefix);
        }
        if let Some(suffix) = entry.strip_prefix('*') {
            return host.ends_with(suffix);
        }
        host == entry || host.ends_with(&format!(".{entry}"))
    })
}

type AgentSocket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// 一条已连 agent socket:分发流、泵帧直到断开。
async fn serve(socket: AgentSocket, port: u16, stop: &mut watch::Receiver<bool>) {
    let (mut tx, mut rx) = socket.split();
    let (out_tx, mut out_rx) = mpsc::channel::<OutFrame>(256);
    let writer = tokio::spawn(async move {
        while let Some(frame) = out_rx.recv().await {
            let message = match frame {
                OutFrame::Text(text) => Message::Text(text.into()),
                OutFrame::Ping => Message::Ping(Vec::new().into()),
            };
            if tx.send(message).await.is_err() {
                break;
            }
        }
    });

    let http: Arc<Mutex<HashMap<u64, PendingHttp>>> = Arc::new(Mutex::new(HashMap::new()));
    /* 已发 HTTP 流任务句柄:serve 收尾统一 abort(悬死响应防 writer 互等)。 */
    let https: Arc<Mutex<Vec<tokio::task::AbortHandle>>> = Arc::new(Mutex::new(Vec::new()));
    let sockets: Arc<Mutex<HashMap<u64, LiveSocket>>> = Arc::new(Mutex::new(HashMap::new()));
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut heartbeat = tokio::time::interval(HEARTBEAT_INTERVAL);
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    heartbeat.tick().await;
    let mut ping_sent_at: Option<tokio::time::Instant> = None;
    /* 悬挂 HTTP 清扫:中继只发 Open+Body 不发 End 的流(攻击/半途死)在此兜底,
     * 不让 PendingHttp 无限滞留。心跳臂顺带扫,免多一个 select 臂。 */
    let mut sweep = tokio::time::interval(std::time::Duration::from_secs(15));
    sweep.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    sweep.tick().await;
    loop {
        let frame = tokio::select! {
            _ = stop.changed() => break,
            _ = heartbeat.tick() => {
                sweep.tick().await; // 与心跳同频即够(15s ≪ TTL 60s)
                sweep_stale(&http);
                if ping_sent_at.take().is_some() {
                    break;
                }
                if !queue_heartbeat(&out_tx, &mut ping_sent_at) {
                    break;
                }
                continue;
            }
            next = rx.next() => {
                ping_sent_at = None;
                match next {
                    Some(Ok(Message::Text(text))) => text.to_string(),
                    Some(Ok(Message::Binary(bytes))) => match String::from_utf8(bytes.to_vec()) {
                        Ok(text) => text,
                        Err(_) => continue,
                    },
                    Some(Ok(_)) => continue,
                    Some(Err(_)) | None => break,
                }
            }
        };
        let Ok(frame) = serde_json::from_str::<AgentFrame>(&frame) else {
            continue;
        };
        match frame {
            AgentFrame::Open {
                id,
                ws,
                method,
                path,
                headers,
            } => {
                if ws {
                    if sockets.lock().len() >= MAX_PENDING_STREAMS {
                        let _ = send(
                            &out_tx,
                            &ClientFrame::Error {
                                id,
                                message: STREAM_CAP_MSG.into(),
                            },
                        )
                        .await;
                        continue;
                    }
                    let live = spawn_socket(id, path, headers, port, out_tx.clone());
                    sockets.lock().insert(id, live);
                } else if http.lock().len() >= MAX_PENDING_STREAMS {
                    let _ = send(
                        &out_tx,
                        &ClientFrame::Error {
                            id,
                            message: STREAM_CAP_MSG.into(),
                        },
                    )
                    .await;
                    continue;
                } else {
                    http.lock().insert(id, admit_http(method, path, headers));
                }
            }
            AgentFrame::Body { id, b64 } => {
                if let Err(()) = feed_http_body(&http, id, &b64) {
                    /* 匿名公网面经中继 POST 即达此处:无上限累积 = 远程 OOM 杀桌面
                     * (全部活会话陪葬)。超限即断流,配中继侧 MAX_STREAMS 纵深。 */
                    let _ = send(
                        &out_tx,
                        &ClientFrame::Error {
                            id,
                            message: "请求体过大".into(),
                        },
                    )
                    .await;
                }
            }
            AgentFrame::End { id } => {
                let pending = http.lock().remove(&id);
                if let Some(pending) = pending {
                    let task = spawn_http(id, pending, port, out_tx.clone(), client.clone());
                    https.lock().push(task);
                }
            }
            AgentFrame::Data { id, b64, text } => {
                let sender = sockets.lock().get(&id).map(|s| s.frames.clone());
                if let Some(sender) = sender {
                    let frame = (b64_to_bytes(&b64), text.unwrap_or(true));
                    match sender.try_send(frame) {
                        Ok(()) => {}
                        Err(mpsc::error::TrySendError::Full(frame)) => {
                            /* 慢手机(蜂窝)排不完时先背压等待,不立刻杀流:杀流 = 手机
                            重连重发,风暴只会更大。超时才判死。上限 2s(评审 F3):
                            await 停住本循环 = 心跳入队同停,必须 ≪ HEARTBEAT_INTERVAL(15s)。 */
                            if tokio::time::timeout(
                                std::time::Duration::from_secs(2),
                                sender.send(frame),
                            )
                            .await
                            .is_err()
                            {
                                if let Some(live) = sockets.lock().remove(&id) {
                                    live.task.abort();
                                }
                                let _ = send(
                                    &out_tx,
                                    &ClientFrame::Error {
                                        id,
                                        message: "本机 socket 积压过久,已断开该连接".into(),
                                    },
                                )
                                .await;
                            }
                        }
                        Err(mpsc::error::TrySendError::Closed(_)) => {
                            sockets.lock().remove(&id);
                        }
                    }
                }
            }
            AgentFrame::Close { id } => {
                if let Some(live) = sockets.lock().remove(&id) {
                    live.task.abort();
                }
                http.lock().remove(&id);
            }
        }
    }

    for (_, live) in sockets.lock().drain() {
        live.task.abort();
    }
    for task in https.lock().drain(..) {
        task.abort();
    }
    http.lock().clear();
    drop(out_tx);
    /* writer 等全部发送端 drop:悬死流已 abort,再给 5s 兜底防互等死锁。 */
    let _ = tokio::time::timeout(std::time::Duration::from_secs(5), writer).await;
}

/// 三防可测小件(评审二轮 TestQuality P1-1):serve 臂表调用,测试直驱。
const STREAM_CAP_MSG: &str = "中继并发流过多,拒绝";

/// HTTP 流入表构造(Open 非 ws 臂;id 由调用方作 map 键)。 */
fn admit_http(method: String, path: String, headers: HashMap<String, String>) -> PendingHttp {
    PendingHttp {
        method,
        path,
        headers,
        body: Vec::new(),
        opened: tokio::time::Instant::now(),
    }
}

/// Body 臂:累积请求体;Err(()) = 超 MAX_HTTP_BODY(调用方发 Error 并断流)。
fn feed_http_body(
    http: &Arc<Mutex<HashMap<u64, PendingHttp>>>,
    id: u64,
    b64: &str,
) -> Result<(), ()> {
    let mut http = http.lock();
    match http.get_mut(&id) {
        Some(pending) => {
            pending.body.extend(b64_to_bytes(b64));
            if pending.body.len() > MAX_HTTP_BODY {
                http.remove(&id);
                Err(())
            } else {
                Ok(())
            }
        }
        None => Ok(()),
    }
}

/// 悬挂流清扫(心跳臂):Open 后超 TTL 未 End 即弃。
fn sweep_stale(http: &Arc<Mutex<HashMap<u64, PendingHttp>>>) {
    http.lock()
        .retain(|_, p| p.opened.elapsed() < PENDING_HTTP_TTL);
}

/// 向本机桥发一个 HTTP 流并回传;返回任务句柄(serve 收尾统一 abort,
/// 否则桥端悬死响应会让 writer.await 互等 → 停中继后 agent 任务滞留)。
fn spawn_http(
    id: u64,
    pending: PendingHttp,
    port: u16,
    out: mpsc::Sender<OutFrame>,
    client: reqwest::Client,
) -> tokio::task::AbortHandle {
    let task = tokio::spawn(async move {
        if !pending.path.starts_with('/') {
            let _ = send(
                &out,
                &ClientFrame::Error {
                    id,
                    message: format!("请求路径无效: {}", pending.path),
                },
            )
            .await;
            return;
        }
        let url = format!("http://127.0.0.1:{port}{}", pending.path);
        let method =
            reqwest::Method::from_bytes(pending.method.as_bytes()).unwrap_or(reqwest::Method::GET);
        let mut request = client.request(method, &url).header(VIA_HEADER, "relay");
        for (name, value) in &pending.headers {
            if hop_headers().contains(&name.to_ascii_lowercase().as_str()) {
                continue;
            }
            request = request.header(name, value);
        }
        let response = match request.body(pending.body).send().await {
            Ok(response) => response,
            Err(e) => {
                let _ = send(
                    &out,
                    &ClientFrame::Error {
                        id,
                        message: format!("本机请求失败: {e}"),
                    },
                )
                .await;
                return;
            }
        };

        let status = response.status().as_u16();
        let mut headers = HashMap::new();
        for (name, value) in response.headers() {
            let name = name.as_str().to_ascii_lowercase();
            if hop_headers().contains(&name.as_str()) {
                continue;
            }
            if let Ok(value) = value.to_str() {
                /* 同名多头 join 保留(insert 只剩最后一份)。注:set-cookie 语义上
                 * 不得列表合并(RFC 7230),当前桥面无生产者;真需要时改 Vec 头。 */
                headers
                    .entry(name)
                    .and_modify(|v: &mut String| {
                        v.push_str(", ");
                        v.push_str(value);
                    })
                    .or_insert_with(|| value.to_string());
            }
        }
        if send(
            &out,
            &ClientFrame::Head {
                id,
                status,
                headers,
            },
        )
        .await
        .is_err()
        {
            return;
        }

        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    if send(
                        &out,
                        &ClientFrame::Data {
                            id,
                            b64: bytes_to_b64(&bytes),
                            text: None,
                        },
                    )
                    .await
                    .is_err()
                    {
                        return;
                    }
                }
                Err(e) => {
                    let _ = send(
                        &out,
                        &ClientFrame::Error {
                            id,
                            message: format!("读取响应失败: {e}"),
                        },
                    )
                    .await;
                    return;
                }
            }
        }
        let _ = send(&out, &ClientFrame::Close { id }).await;
    });
    task.abort_handle()
}

/// 拨本机桥的 socket 路由,双向泵载荷。
fn spawn_socket(
    id: u64,
    path: String,
    headers: HashMap<String, String>,
    port: u16,
    out: mpsc::Sender<OutFrame>,
) -> LiveSocket {
    let (frames_tx, mut frames_rx) = mpsc::channel::<(Vec<u8>, bool)>(256);
    let handle = tokio::spawn(async move {
        let target = format!("ws://127.0.0.1:{port}{path}");
        let Ok(mut request) = target.into_client_request() else {
            let _ = send(
                &out,
                &ClientFrame::Error {
                    id,
                    message: "socket path is invalid".into(),
                },
            )
            .await;
            return;
        };
        request.headers_mut().insert(
            tokio_tungstenite::tungstenite::http::HeaderName::from_static(VIA_HEADER),
            tokio_tungstenite::tungstenite::http::HeaderValue::from_static("relay"),
        );
        for (name, value) in &headers {
            if hop_headers().contains(&name.to_ascii_lowercase().as_str())
                || name.to_ascii_lowercase().starts_with("sec-websocket")
                || name.eq_ignore_ascii_case("origin")
            {
                continue;
            }
            if let (Ok(name), Ok(value)) = (
                name.parse::<tokio_tungstenite::tungstenite::http::HeaderName>(),
                value.parse::<tokio_tungstenite::tungstenite::http::HeaderValue>(),
            ) {
                request.headers_mut().insert(name, value);
            }
        }

        let socket = match tokio_tungstenite::connect_async(request).await {
            Ok((socket, _)) => socket,
            Err(e) => {
                #[cfg(debug_assertions)]
                eprintln!("[relay-agent] 本机 WS 拨号失败 id={id}: {e}");
                let _ = send(
                    &out,
                    &ClientFrame::Error {
                        id,
                        message: format!("本机 socket 连接失败: {e}"),
                    },
                )
                .await;
                return;
            }
        };
        let (mut ws_tx, mut ws_rx) = socket.split();

        loop {
            tokio::select! {
                frame = frames_rx.recv() => match frame {
                    Some((bytes, as_text)) => {
                        let message = if as_text {
                            Message::Text(String::from_utf8_lossy(&bytes).into_owned().into())
                        } else {
                            Message::Binary(bytes.into())
                        };
                        if ws_tx.send(message).await.is_err() {
                            break;
                        }
                    }
                    None => {
                        let _ = ws_tx.send(Message::Close(None)).await;
                        break;
                    }
                },
                message = ws_rx.next() => match message {
                    /* 单帧载荷守卫(评审二轮 P1-3):invoke 全量响应(大文件 base64)
                     * 打包成一条 Data 帧超中继解析上限时,整条 agent socket 会被拆除
                     * 进重拨循环。改为对该流回 Error 并关流,单请求失败 ≠ 断链。 */
                    Some(Ok(Message::Binary(bytes))) => {
                        if bytes_to_b64(&bytes).len() > MAX_CLIENT_FRAME {
                            let _ = send(&out, &ClientFrame::Error {
                                id,
                                message: "响应载荷超过中继线帧上限,请在桌面端处理该文件".into(),
                            }).await;
                            break;
                        }
                        if send(&out, &ClientFrame::Data { id, b64: bytes_to_b64(&bytes), text: Some(false) }).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Text(text))) => {
                        if text.len() > MAX_CLIENT_FRAME {
                            let _ = send(&out, &ClientFrame::Error {
                                id,
                                message: "响应载荷超过中继线帧上限,请在桌面端处理该文件".into(),
                            }).await;
                            break;
                        }
                        if send(&out, &ClientFrame::Data { id, b64: bytes_to_b64(text.as_bytes()), text: Some(true) }).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    Some(Ok(_)) => continue,
                },
            }
        }
        let _ = send(&out, &ClientFrame::Close { id }).await;
    });
    LiveSocket {
        frames: frames_tx,
        task: handle.abort_handle(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 评审二轮 TestQuality P1-1:P0 三防(体限/清扫/流表帽)回归锚。
    #[test]
    fn http体超限即断流() {
        let http: Arc<Mutex<HashMap<u64, PendingHttp>>> = Arc::new(Mutex::new(HashMap::new()));
        http.lock().insert(
            7,
            PendingHttp {
                method: "POST".into(),
                path: "/".into(),
                headers: HashMap::new(),
                body: Vec::new(),
                opened: tokio::time::Instant::now(),
            },
        );
        // 8MB 上限:灌 8MB+1 必超;b64 of 8MB zeros
        let big = "A".repeat((MAX_HTTP_BODY / 3 + 1) * 4); // STANDARD b64 必须补齐 4 倍长;解码 3/4 后恰超上限一字节
        assert!(feed_http_body(&http, 7, &big).is_err(), "超限应 Err");
        assert!(
            !http.lock().contains_key(&7),
            "超限后条目必须移除(End 不得再触发 spawn)"
        );
        // 未超限路径
        http.lock().insert(
            8,
            PendingHttp {
                method: "POST".into(),
                path: "/".into(),
                headers: HashMap::new(),
                body: Vec::new(),
                opened: tokio::time::Instant::now(),
            },
        );
        assert!(feed_http_body(&http, 8, "QUJD").is_ok());
        assert_eq!(http.lock().get(&8).unwrap().body, b"ABC");
        // 未知 id 静默
        assert!(feed_http_body(&http, 999, "QQ==").is_ok());
    }

    #[test]
    fn 悬挂流超ttl被清扫() {
        let http: Arc<Mutex<HashMap<u64, PendingHttp>>> = Arc::new(Mutex::new(HashMap::new()));
        let mut stale = admit_http("GET".into(), "/".into(), HashMap::new());
        stale.opened =
            tokio::time::Instant::now() - PENDING_HTTP_TTL - std::time::Duration::from_secs(1);
        http.lock().insert(1, stale);
        http.lock()
            .insert(2, admit_http("GET".into(), "/".into(), HashMap::new()));
        sweep_stale(&http);
        assert!(!http.lock().contains_key(&1), "超 TTL 应清扫");
        assert!(http.lock().contains_key(&2), "未超 TTL 保留");
    }

    #[test]
    fn 流表帽512() {
        assert_eq!(MAX_PENDING_STREAMS, 512); // 钉常量:改动需过此测试(评审有意识决策)
    }

    #[test]
    fn proxy_url_parses_http_with_credentials() {
        let p = proxy_from_url("http://u:p@127.0.0.1:7890/path").unwrap();
        assert_eq!(p.kind, SshProxyKind::Http);
        assert_eq!((p.host.as_str(), p.port), ("127.0.0.1", 7890));
        assert_eq!((p.username.as_str(), p.password.as_str()), ("u", "p"));
    }

    #[test]
    fn proxy_url_scheme_defaults_and_rejects() {
        // 裸 host:port 按 env 惯例 = HTTP(与 ssh 配置的 socks 缺省不同)
        assert_eq!(
            proxy_from_url("127.0.0.1:8888").unwrap().kind,
            SshProxyKind::Http
        );
        assert_eq!(proxy_from_url("socks5://10.0.0.1").unwrap().port, 1080);
        assert!(proxy_from_url("socks4://10.0.0.1").is_none());
        assert!(proxy_from_url("http://").is_none());
    }

    #[test]
    fn no_proxy_exact_and_suffix_only() {
        let list = "localhost,127.*,*.workers.dev,example.com";
        assert!(host_in_no_proxy("example.com", list));
        assert!(host_in_no_proxy("a.example.com", list));
        assert!(host_in_no_proxy("x.workers.dev", list));
        // 子域后缀匹配不吃裸域名通配缺失:notexample.com 不匹配 example.com
        assert!(!host_in_no_proxy("notexample.com", list));
        assert!(!host_in_no_proxy(
            "tmd-relay.451624324.workers.dev",
            "localhost,127.0.0.1,::1"
        ));
    }
}
