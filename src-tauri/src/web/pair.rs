//! 配对 HTTP 面:offer 铸造(tmd://pair?c=…)+ POST /pair。
//! pairCode 即凭据(不做 URL token 闸);按来源 IP 节流,超限 429 并发告警事件。

use axum::extract::{ConnectInfo, State as AxumState};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::net::SocketAddr;
use tauri::{AppHandle, Manager};

use super::{devices, server::WebCtx};

/// 手机端 POST /pair 请求体。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairReq {
    pair_code: String,
    device_name: String,
}

/// 配对成功应答(device token 明文只此一次下发)。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PairGranted<'a> {
    device_id: &'a str,
    device_token: &'a str,
    host_id: String,
    name: String,
    version: &'a str,
}

/// base64url(无 pad)编码 offer JSON,拼 tmd://pair?c=…。
fn encode_offer(payload: &serde_json::Value) -> String {
    let raw = payload.to_string();
    let c = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw.as_bytes());
    format!("tmd://pair?c={c}")
}

/// 桌面展示名:主机名,拿不到回落 tmd-cli(进程内缓存)。
fn host_name() -> String {
    static NAME: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
        std::process::Command::new("hostname")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "tmd-cli".into())
    });
    NAME.clone()
}

/// 铸一次性配对 offer(桥须在运行:LAN 取自 WebAccessInfo;relay 已连接才带)。
/// 返回 (tmd://pair url, pairCode, expires_at)。
pub(crate) fn mint_offer(app: &AppHandle) -> Result<(String, String, u64), String> {
    let state = app.state::<crate::AppState>();
    let info = state.web.status().ok_or("Web 访问未开启,先打开内网访问")?;
    let (code, expires_at) = state.devices.mint_code(devices::now_secs());
    let relay = crate::web::relay::web_relay_status(app.clone())
        .filter(|r| r.connected)
        // 设备配对只要中继基址;RelayInfo.url 是浏览器链接(带 ?token=),不能进
        // offer —— 既把桥凭据泄漏进可分享的配对链接,形状也拼不出 /pair 的 base。
        .and_then(|r| {
            let base = r
                .url
                .split('?')
                .next()
                .unwrap_or_default()
                .trim_end_matches('/')
                .to_string();
            (!base.is_empty()).then_some(base)
        });
    let payload = json!({
        "v": 1,
        "hostId": devices::host_id(&devices::devices_dir()),
        "name": host_name(),
        "pairCode": code,
        "lan": format!("http://{}:{}", info.lan_ip, info.port),
        "relay": relay,
    });
    Ok((encode_offer(&payload), code, expires_at))
}

/// POST /pair:码错 403 / 过期 410 / 节流 429 / 设备表写失败 500。
/// 壳 origin(app://tmd)与 relay 基址跨域:响应挂 CORS 头,并配 OPTIONS 预检
/// (前端 fetch 带 JSON content-type 必触发预检;node 脚本无 CORS 掩盖过此缺口)。
pub(crate) fn cors(mut resp: Response) -> Response {
    let h = resp.headers_mut();
    h.insert(
        axum::http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
        axum::http::HeaderValue::from_static("*"),
    );
    h.insert(
        axum::http::header::ACCESS_CONTROL_ALLOW_METHODS,
        axum::http::HeaderValue::from_static("POST, OPTIONS"),
    );
    h.insert(
        axum::http::header::ACCESS_CONTROL_ALLOW_HEADERS,
        axum::http::HeaderValue::from_static("content-type"),
    );
    resp
}

pub(crate) async fn pair_preflight() -> Response {
    cors(StatusCode::NO_CONTENT.into_response())
}

pub(crate) async fn pair_handler(
    AxumState(ctx): AxumState<WebCtx>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(req): Json<PairReq>,
) -> Response {
    let state = ctx.app.state::<crate::AppState>();
    let registry = &state.inner().devices;
    let resp = pair_inner(registry, ctx.clone(), addr, req).await;
    cors(resp)
}

async fn pair_inner(
    registry: &devices::DeviceRegistry,
    ctx: WebCtx,
    addr: SocketAddr,
    req: PairReq,
) -> Response {
    let ip = addr.ip().to_string();
    if registry.pair_denied(&ip) {
        return (StatusCode::TOO_MANY_REQUESTS, "配对尝试过多,稍后再试").into_response();
    }
    match registry.pair(
        &devices::devices_dir(),
        &req.pair_code,
        &req.device_name,
        &ip,
        devices::now_secs(),
    ) {
        Ok((device_id, token)) => {
            registry.note_ok(&ip);
            // 桌面配对卡联动:pending 行立即出现 + 配对码收起(等 TTL 收码会卡住授权流)
            crate::event_sink::emit(&ctx.app, "web://devices", &json!({}));
            crate::event_sink::emit(&ctx.app, "web://pair-consumed", &json!({}));
            let granted = PairGranted {
                device_id: &device_id,
                device_token: &token,
                host_id: devices::host_id(&devices::devices_dir()),
                name: host_name(),
                version: env!("CARGO_PKG_VERSION"),
            };
            (StatusCode::OK, Json(granted)).into_response()
        }
        Err(devices::PairError::Expired) => (StatusCode::GONE, "配对码已过期").into_response(),
        Err(devices::PairError::Storage) => {
            (StatusCode::INTERNAL_SERVER_ERROR, "设备表写入失败").into_response()
        }
        Err(devices::PairError::BadCode) => {
            /* 告警阈值:relay 面按全局桶上限,单 IP 面按本地上限(红队链5)。 */
            let limit = if ip == "127.0.0.1" {
                devices::RELAY_FAIL_LIMIT
            } else {
                devices::PAIR_FAIL_LIMIT
            };
            if registry.note_fail(&ip) >= limit {
                crate::event_sink::emit(
                    &ctx.app,
                    "web://pair-alert",
                    &json!({ "ip": ip, "limit": limit }),
                );
            }
            (StatusCode::FORBIDDEN, "配对码不正确").into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offer_编码可解码回读() {
        let payload = json!({
            "v": 1, "hostId": "ab", "name": "mac", "pairCode": "ABCD-1234",
            "lan": "http://192.168.1.2:60000", "relay": serde_json::Value::Null
        });
        let url = encode_offer(&payload);
        assert!(url.starts_with("tmd://pair?c="));
        let c = &url["tmd://pair?c=".len()..];
        let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(c)
            .unwrap();
        let back: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(back, payload);
    }

    #[test]
    fn host_name_非空() {
        assert!(!host_name().is_empty());
    }

    #[test]
    fn cors_头挂在所有pair响应上() {
        let resp = cors((StatusCode::FORBIDDEN, "配对码不正确").into_response());
        let h = resp.headers();
        assert_eq!(h[axum::http::header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
        assert_eq!(
            h[axum::http::header::ACCESS_CONTROL_ALLOW_METHODS],
            "POST, OPTIONS"
        );
        assert_eq!(
            h[axum::http::header::ACCESS_CONTROL_ALLOW_HEADERS],
            "content-type"
        );
        // 原状态码与 content 不被包装吞掉
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }
}
