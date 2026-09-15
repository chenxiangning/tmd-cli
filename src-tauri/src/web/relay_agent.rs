//! 外网中继(agent 任务半):出站拨号、心跳保活、HTTP/WS 流多路复用。
//! relay.rs 只留状态与命令;本文件内纯异步逻辑可独立单测。

// file-size-exempt: relay 出站拨号+多路复用+部署,与 codemoss relay.rs 同源;拆分已做(state/core/agent 三件),再细即拆散同一条协议
use std::collections::HashMap;
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

use super::relay_core::{
    b64_to_bytes, bytes_to_b64, hop_headers, queue_heartbeat, redial_until_connected, send,
    AgentFrame, ClientFrame, LiveSocket, OutFrame, PendingHttp, HEARTBEAT_INTERVAL,
    REDIAL_DELAY_MS, VIA_HEADER,
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
                async move {
                    let request = agent
                        .into_client_request()
                        .map_err(|e| format!("中继地址无效: {e}"))?;
                    tokio_tungstenite::connect_async(request)
                        .await
                        .map_err(|e| e.to_string())
                }
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
        let Some((socket, _)) = connected else {
            return;
        };
        super::relay::set_error(&app, generation, String::new());
        super::relay::set_connected(&app, generation, true);
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
    let sockets: Arc<Mutex<HashMap<u64, LiveSocket>>> = Arc::new(Mutex::new(HashMap::new()));
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut heartbeat = tokio::time::interval(HEARTBEAT_INTERVAL);
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    heartbeat.tick().await;
    let mut ping_sent_at: Option<tokio::time::Instant> = None;

    loop {
        let frame = tokio::select! {
            _ = stop.changed() => break,
            _ = heartbeat.tick() => {
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
                    let live = spawn_socket(id, path, headers, port, out_tx.clone());
                    sockets.lock().insert(id, live);
                } else {
                    http.lock().insert(
                        id,
                        PendingHttp {
                            method,
                            path,
                            headers,
                            body: Vec::new(),
                        },
                    );
                }
            }
            AgentFrame::Body { id, b64 } => {
                if let Some(pending) = http.lock().get_mut(&id) {
                    pending.body.extend(b64_to_bytes(&b64));
                }
            }
            AgentFrame::End { id } => {
                let pending = http.lock().remove(&id);
                if let Some(pending) = pending {
                    spawn_http(id, pending, port, out_tx.clone(), client.clone());
                }
            }
            AgentFrame::Data { id, b64, text } => {
                let sender = sockets.lock().get(&id).map(|s| s.frames.clone());
                if let Some(sender) = sender {
                    // try_send 绝不 await:await 会停住本循环,而它同时是所有流的唯一读者。
                    match sender.try_send((b64_to_bytes(&b64), text.unwrap_or(true))) {
                        Ok(()) => {}
                        Err(mpsc::error::TrySendError::Full(_)) => {
                            if let Some(live) = sockets.lock().remove(&id) {
                                live.task.abort();
                            }
                            let _ = send(
                                &out_tx,
                                &ClientFrame::Error {
                                    id,
                                    message: "本机 socket 积压过多,已断开该连接".into(),
                                },
                            )
                            .await;
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
    http.lock().clear();
    drop(out_tx);
    let _ = writer.await;
}

/// 向本机桥发一个 HTTP 流并回传。
fn spawn_http(
    id: u64,
    pending: PendingHttp,
    port: u16,
    out: mpsc::Sender<OutFrame>,
    client: reqwest::Client,
) {
    tokio::spawn(async move {
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
                headers.insert(name, value.to_string());
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
                    Some(Ok(Message::Binary(bytes))) => {
                        if send(&out, &ClientFrame::Data { id, b64: bytes_to_b64(&bytes), text: Some(false) }).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Text(text))) => {
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
