//! 外网中继(纯逻辑半):协议帧、URL 整形、重拨退避、心跳、b64、部署包(zip)。
//! 与 codemoss relay.rs 对齐;设备/持久化收口见 relay.rs。

// file-size-exempt: relay 出站拨号+多路复用+部署,与 codemoss relay.rs 同源;拆分已做(state/core/agent 三件),再细即拆散同一条协议
use std::collections::HashMap;
use std::future::Future;

use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, watch};

/// 掉线后再拨的间隔:Worker 回收旧连接足够短,手机侧几乎无感。
pub(super) const REDIAL_DELAY_MS: u64 = 1_000;
/// 重拨退避上限。拨号失败会一直重试(见 relay::run_agent),间隔必须有顶。
const REDIAL_MAX_MS: u64 = 30_000;
/// 存活探测周期:Cloudflare 抖动会让 socket 在本地保持 open 但 Durable Object
/// 已死,一个周期无应答就断开让外层重拨。
pub(super) const HEARTBEAT_INTERVAL: std::time::Duration = std::time::Duration::from_secs(15);
/// 单次拨号超时:connect_async 无内建超时,半开会永远停在握手、stop 永远等不到。
pub(super) const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
/// HTTP 请求体上限:经中继的匿名公网面可达,超限断流防 OOM(配中继侧纵深)。
pub(super) const MAX_HTTP_BODY: usize = 8 * 1024 * 1024;
/// 悬挂 HTTP 流(Open 后 60s 未 End)兜底 TTL。
pub(super) const PENDING_HTTP_TTL: std::time::Duration = std::time::Duration::from_secs(60);
/// 单 agent 出站帧上限(b64 后):mjs AGENT_MAX_FRAME=32MiB 再留余量。
/// 预算链(评审二轮 P1-3 跨层对齐):手机 invoke 帧 ≤3.5MiB(transportBridge 守卫)
/// < PHONE_MAX_FRAME 4MiB;桌面响应帧 ≤ 此值 < 中继 32MiB —— 超限走带内 Error 不断链。
pub(super) const MAX_CLIENT_FRAME: usize = 30 * 1024 * 1024;
pub(super) const MAX_PENDING_STREAMS: usize = 512;
/// 标记经中继进入本机的流量:桥的 VIA 语义。
pub const VIA_HEADER: &str = "x-tmd-via";

/// 跨 hop 不得透传的头:hop-by-hop 头跨中继无意义;VIA_HEADER 是我们自己的,
/// 手机自报一份就能替桥决定请求分类。
const HOP_HEADERS: [&str; 9] = [
    "host",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
    "content-length",
    "accept-encoding",
    "sec-websocket-extensions",
    VIA_HEADER,
];

#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub(super) enum AgentFrame {
    Open {
        id: u64,
        #[serde(default)]
        ws: bool,
        #[serde(default)]
        method: String,
        #[serde(default)]
        path: String,
        #[serde(default)]
        headers: HashMap<String, String>,
    },
    Body {
        id: u64,
        b64: String,
    },
    End {
        id: u64,
    },
    /// Socket 载荷:手机 → 桌面。
    Data {
        id: u64,
        b64: String,
        /// Worker 可把文本帧原样交回:text 缺省按 text 处理。
        #[serde(skip_serializing_if = "Option::is_none")]
        text: Option<bool>,
    },
    Close {
        id: u64,
    },
}

#[derive(Serialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub(super) enum ClientFrame {
    Head {
        id: u64,
        status: u16,
        headers: HashMap<String, String>,
    },
    Data {
        id: u64,
        b64: String,
        /// Worker 侧帧型:桥协议是 JSON text,缺省按 text 处理。
        #[serde(default)]
        text: Option<bool>,
    },
    Close {
        id: u64,
    },
    Error {
        id: u64,
        message: String,
    },
}

pub(super) struct PendingHttp {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
    /// Open 到达时刻:悬挂流 TTL 清扫依据。
    pub opened: tokio::time::Instant,
}

/// 活 socket 流:close 所需的句柄。
pub(super) struct LiveSocket {
    /// 帧字节 + 是否 text 帧(见 relay::spawn_socket)。
    pub frames: mpsc::Sender<(Vec<u8>, bool)>,
    pub task: tokio::task::AbortHandle,
}

/// writer 往线上写什么:协议应答 + 读循环排入的心跳。
pub(super) enum OutFrame {
    Text(String),
    Ping,
}

/// `https://host` → `wss://host/agent?key=…`,`http://host` → `ws://…`。
pub fn agent_url(base: &str, key: &str) -> Result<String, String> {
    let base = base.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("relay address is empty".into());
    }
    let ws = if let Some(rest) = base.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = base.strip_prefix("http://") {
        format!("ws://{rest}")
    } else if base.starts_with("ws://") || base.starts_with("wss://") {
        base.to_string()
    } else {
        format!("wss://{base}")
    };
    Ok(format!("{ws}/agent?key={}", urlencode(key)))
}

/// 手机打开的地址:裸 Worker 基址(token 由桥侧 URL/配对承担)。
pub fn phone_url(base: &str) -> String {
    format!("{}/", base.trim().trim_end_matches('/'))
}

fn urlencode(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            other => format!("%{other:02X}"),
        })
        .collect()
}

/// 新 relay 密钥:32 位无歧义字母表。会进 agent URL 与 Durable Object 名。
pub fn new_relay_key() -> String {
    const ALPHABET: &[u8] = b"23456789BCDFGHJKLMNPQRSTVWXZ";
    const LEN: usize = 32;
    let mut out = String::with_capacity(LEN);
    while out.len() < LEN {
        for byte in uuid::Uuid::new_v4().as_bytes() {
            if out.len() == LEN {
                break;
            }
            out.push(ALPHABET[*byte as usize % ALPHABET.len()] as char);
        }
    }
    out
}

/// 重拨退避:1s, 2s, 4s … 封顶。
pub(super) fn redial_delay(attempt: u32) -> std::time::Duration {
    let shift = attempt.saturating_sub(1).min(5);
    std::time::Duration::from_millis((REDIAL_DELAY_MS << shift).min(REDIAL_MAX_MS))
}

/// 拨到 socket 起来或 stop 翻转为止;失败按封顶退避重试,只有 stop 能停。
pub(super) async fn redial_until_connected<S, F, Fut>(
    stop: &mut watch::Receiver<bool>,
    mut dial: F,
    mut on_failure: impl FnMut(u32, String),
) -> Option<S>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<S, String>>,
{
    let mut attempt = 0u32;
    loop {
        if *stop.borrow() {
            return None;
        }
        let dialed = tokio::select! {
            biased;
            _ = stop.changed() => None,
            result = tokio::time::timeout(CONNECT_TIMEOUT, dial()) => {
                Some(match result {
                    Ok(outcome) => outcome,
                    Err(_) => Err(format!("连接超时({} 秒)", CONNECT_TIMEOUT.as_secs())),
                })
            }
        };
        match dialed {
            None => return None,
            Some(Ok(socket)) => {
                if *stop.borrow() {
                    return None;
                }
                return Some(socket);
            }
            Some(Err(error)) => {
                attempt = attempt.saturating_add(1);
                on_failure(attempt, error);
            }
        }
        if *stop.borrow() {
            return None;
        }
        tokio::select! {
            _ = tokio::time::sleep(redial_delay(attempt)) => {}
            _ = stop.changed() => return None,
        }
    }
}

/// 心跳入队:队列满说明 writer 有活在干;只有真进队的 Ping 才配启动应答计时。
pub(super) fn queue_heartbeat(
    out: &mpsc::Sender<OutFrame>,
    ping_sent_at: &mut Option<tokio::time::Instant>,
) -> bool {
    match out.try_send(OutFrame::Ping) {
        Ok(()) => {
            *ping_sent_at = Some(tokio::time::Instant::now());
            true
        }
        Err(mpsc::error::TrySendError::Full(_)) => true,
        Err(mpsc::error::TrySendError::Closed(_)) => false,
    }
}

pub(super) async fn send(out: &mpsc::Sender<OutFrame>, frame: &ClientFrame) -> Result<(), ()> {
    let Ok(text) = serde_json::to_string(frame) else {
        return Err(());
    };
    out.send(OutFrame::Text(text)).await.map_err(|_| ())
}

pub(super) fn b64_to_bytes(text: &str) -> Vec<u8> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .unwrap_or_default()
}

pub(super) fn bytes_to_b64(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

pub(super) fn hop_headers() -> &'static [&'static str] {
    &HOP_HEADERS
}

// ==================== 部署包(zip STORE) ====================

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

fn push_u16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

/// 极简 STORE(无压缩) zip 写手。故意不引依赖:包是 ~9KB 文本,原样落盘。
pub(super) fn zip_store(files: &[(&str, &[u8])]) -> Vec<u8> {
    const DOS_DATE: u16 = (45 << 9) | (1 << 5) | 1;
    const DOS_TIME: u16 = 0;

    let mut out = Vec::new();
    let mut central = Vec::new();
    for (name, data) in files {
        let offset = out.len() as u32;
        let crc = crc32(data);
        let size = data.len() as u32;
        let name_len = name.len() as u16;

        push_u32(&mut out, 0x0403_4b50);
        push_u16(&mut out, 20);
        push_u16(&mut out, 0);
        push_u16(&mut out, 0);
        push_u16(&mut out, DOS_TIME);
        push_u16(&mut out, DOS_DATE);
        push_u32(&mut out, crc);
        push_u32(&mut out, size);
        push_u32(&mut out, size);
        push_u16(&mut out, name_len);
        push_u16(&mut out, 0);
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(data);

        push_u32(&mut central, 0x0201_4b50);
        push_u16(&mut central, 20);
        push_u16(&mut central, 20);
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u16(&mut central, DOS_TIME);
        push_u16(&mut central, DOS_DATE);
        push_u32(&mut central, crc);
        push_u32(&mut central, size);
        push_u32(&mut central, size);
        push_u16(&mut central, name_len);
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u32(&mut central, 0);
        push_u32(&mut central, offset);
        central.extend_from_slice(name.as_bytes());
    }

    let central_offset = out.len() as u32;
    let central_size = central.len() as u32;
    out.extend_from_slice(&central);
    push_u32(&mut out, 0x0605_4b50);
    push_u16(&mut out, 0);
    push_u16(&mut out, 0);
    push_u16(&mut out, files.len() as u16);
    push_u16(&mut out, files.len() as u16);
    push_u32(&mut out, central_size);
    push_u32(&mut out, central_offset);
    push_u16(&mut out, 0);
    out
}

/// 构建时的 Worker 源码内嵌:deploy 树不在任何 bundle 里。
pub const WORKER_SOURCE: &str = include_str!("../../deploy/worker/src/index.js");

/// 部署包:Worker 源码 + wrangler 工程,RELAY_KEY 已烧入。
fn deploy_pack(key: &str) -> Vec<u8> {
    let wrangler = format!(
        r#"name = "tmd-relay"
main = "src/index.js"
compatibility_date = "2025-01-01"

[[durable_objects.bindings]]
name = "RELAY"
class_name = "Relay"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Relay"]

[vars]
# 与 tmd-cli「中转密钥」保持一致。改后无需重新部署(控制台 Variables 里改)。
RELAY_KEY = "{key}"
"#
    );
    let readme = r#"tmd-cli 外网穿透 · 中继部署包

1. 装 Node >= 16.17(只为拿 npx wrangler)。
2. npx wrangler login
3. npx wrangler deploy  # 输出 https://tmd-relay.<你的子域>.workers.dev
4. tmd-cli → 设置 → Web 访问 → 外网中转:地址=上面的 URL,密钥=本包 RELAY_KEY。
5. 点「连接中转」;手机打开该 URL。
"#;
    zip_store(&[
        ("tmd-relay/README.txt", readme.as_bytes()),
        ("tmd-relay/wrangler.toml", wrangler.as_bytes()),
        ("tmd-relay/src/index.js", WORKER_SOURCE.as_bytes()),
    ])
}

/// 部署包落盘;无 key 时铸新的一份(包与 GUI 一致)。
pub fn write_deploy_pack(path: &str, key: Option<&str>) -> Result<String, String> {
    let key = key
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(new_relay_key);
    std::fs::write(path, deploy_pack(&key)).map_err(|e| format!("写入 {path} 失败: {e}"))?;
    Ok(key)
}

/// CF 部署结果。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayDeployResult {
    pub url: String,
    pub key: String,
    pub account_id: String,
    pub account_name: String,
}

pub const CF_API_BASE: &str = "https://api.cloudflare.com/client/v4";
pub const CF_SCRIPT_NAME: &str = "tmd-relay";
