//! Quota 查询 ─ 通用 HTTP 代理。
//! 每个 CLI 插件(clp-pi/cli-omp/cli-codex)在 JS 侧拼装 URL/headers,
//! 这里统一执行请求并返回 JSON。避免每个供应商写一套 Rust 网络代码。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// SSE 流式应答(text/event-stream)专用:流不关闭,.text() 读到 EOF 会挂到
/// 15s 超时误判不可达(MCP streamable-http 探活)。仅对这类应答开「无新
/// 数据窗 + 读体上限」——静默满窗带已读前缀返回,上限防长驻流无界累积;
/// 普通 JSON/atom 应答保持整读语义(慢端点中段停顿不受影响)。
const BODY_READ_CAP: usize = 2 * 1024 * 1024;
const BODY_IDLE: std::time::Duration = std::time::Duration::from_secs(2);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaRequest {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    /// true = 响应按原始文本返回(body 为 JSON 字符串值),跳过 JSON 解析。
    /// 供非 JSON 源使用(如 GitHub releases.atom 更新源)。
    pub text: Option<bool>,
    /// true = 不跟随重定向(3xx 原样返回),供鉴权 cookie 交换等场景。
    pub no_redirect: Option<bool>,
    /// true = 响应携带 headers(多值 map,set-cookie 等多值头不丢)。
    pub include_headers: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaResponse {
    pub status: u16,
    pub body: serde_json::Value,
    /// 请求方声明 include_headers 时才填充;键为小写头名,值保留多值序。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, Vec<String>>>,
}

/// 通用 HTTP proxy ─ 把任意 HTTP 请求转成命令调用,响应 JSON 返回。
/// 失败时返回 Err(string),由前端展示。
#[tauri::command]
pub async fn quota_fetch(spec: QuotaRequest) -> Result<QuotaResponse, String> {
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15));
    if spec.no_redirect.unwrap_or(false) {
        builder = builder.redirect(reqwest::redirect::Policy::none());
    }
    let client = builder
        .build()
        .map_err(|e| format!("http client build: {e}"))?;

    let method = spec.method.as_deref().unwrap_or("GET").to_uppercase();

    let mut req = match method.as_str() {
        "GET" => client.get(&spec.url),
        "POST" => client.post(&spec.url),
        "PUT" => client.put(&spec.url),
        "DELETE" => client.delete(&spec.url),
        other => return Err(format!("unsupported method: {other}")),
    };

    if let Some(headers) = spec.headers {
        for (k, v) in headers {
            req = req.header(&k, &v);
        }
    }

    if let Some(body) = spec.body {
        req = req.body(body);
    }

    let resp = req.send().await.map_err(|e| format!("http send: {e}"))?;

    let status = resp.status().as_u16();
    let headers = if spec.include_headers.unwrap_or(false) {
        let mut map: HashMap<String, Vec<String>> = HashMap::new();
        for (k, v) in resp.headers() {
            if let Ok(s) = v.to_str() {
                map.entry(k.as_str().to_ascii_lowercase())
                    .or_default()
                    .push(s.to_string());
            }
        }
        Some(map)
    } else {
        None
    };
    /* SSE 探测在 headers 消费后、体读走 resp 所有权前完成。 */
    let streaming = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|ct| ct.to_ascii_lowercase().contains("text/event-stream"));
    let mut resp = resp;
    let mut body_buf: Vec<u8> = Vec::new();
    loop {
        if streaming && body_buf.len() >= BODY_READ_CAP {
            break; /* SSE 到上限即止:消费方(探活)只需应答头部 */
        }
        let next = if streaming {
            tokio::time::timeout(BODY_IDLE, resp.chunk()).await
        } else {
            Ok(resp.chunk().await)
        };
        match next {
            Err(_elapsed) => break, /* SSE 静默满窗:流已完/长驻,取已读前缀 */
            Ok(Err(e)) => return Err(format!("http read body: {e}")),
            Ok(Ok(Some(chunk))) => body_buf.extend_from_slice(&chunk),
            Ok(Ok(None)) => break, /* EOF:常规应答整突发即完 */
        }
    }
    let body_text = String::from_utf8_lossy(&body_buf).into_owned();

    let body: serde_json::Value = if spec.text.unwrap_or(false) {
        serde_json::Value::String(body_text)
    } else {
        serde_json::from_str(&body_text).map_err(|e| {
            /* 非 JSON 响应常是 CJK/HTML 错误页:按字节切 500 会劈进多字节字符 → panic(abort)。
             * 按字符截断,天然落在边界上。 */
            let preview: String = body_text.chars().take(200).collect();
            format!("http parse json: {e}; body={preview}")
        })?
    };

    Ok(QuotaResponse {
        status,
        body,
        headers,
    })
}

/// 读取 quota provider 使用的环境变量。仅返回非空值,不执行 shell 命令。
/// 纵深防御:renderer 不可信,仅放行密钥/token 类与 pi 配置目录覆盖,
/// 阻断 PATH/HOME 等任意环境变量读取。
#[tauri::command]
pub fn quota_env_value(name: String) -> Option<String> {
    let key = name.trim();
    if key.is_empty() {
        return None;
    }
    let allowed = key.ends_with("_KEY")
        || key.ends_with("_TOKEN")
        || key.ends_with("_SECRET")
        || key.starts_with("QUOTA_")
        || key.starts_with("PI_");
    if !allowed {
        return None;
    }
    std::env::var(key)
        .ok()
        .filter(|value| !value.trim().is_empty())
}
