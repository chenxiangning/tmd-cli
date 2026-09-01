//! Quota 查询 ─ 通用 HTTP 代理。
//! 每个 CLI 插件(clp-pi/cli-omp/cli-codex)在 JS 侧拼装 URL/headers,
//! 这里统一执行请求并返回 JSON。避免每个供应商写一套 Rust 网络代码。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaRequest {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaResponse {
    pub status: u16,
    pub body: serde_json::Value,
}

/// 通用 HTTP proxy ─ 把任意 HTTP 请求转成命令调用,响应 JSON 返回。
/// 失败时返回 Err(string),由前端展示。
#[tauri::command]
pub async fn quota_fetch(spec: QuotaRequest) -> Result<QuotaResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("http client build: {e}"))?;

    let method = spec
        .method
        .as_deref()
        .unwrap_or("GET")
        .to_uppercase();

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

    let resp = req
        .send()
        .await
        .map_err(|e| format!("http send: {e}"))?;

    let status = resp.status().as_u16();
    let body_text = resp
        .text()
        .await
        .map_err(|e| format!("http read body: {e}"))?;

    let body: serde_json::Value = serde_json::from_str(&body_text)
        .map_err(|e| format!("http parse json: {e}; body={}", &body_text[..body_text.len().min(500)]))?;

    Ok(QuotaResponse { status, body })
}

/// 读取 omp CLI 某供应商的最新凭据 data JSON(auth_credentials 表)。
/// omp 凭据存 sqlite(~/.omp/agent/agent.db),JS 无法解析,由 Rust 只读取出。
/// 库不存在/无记录返回 Ok(None),不抛错(前端据此显示空态)。
#[tauri::command]
pub fn omp_auth_credential(provider: String) -> Result<Option<String>, String> {
    let db_path = dirs::home_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(".omp/agent/agent.db");
    if !db_path.exists() {
        return Ok(None);
    }
    let conn = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| format!("open omp agent.db: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT data FROM auth_credentials \
             WHERE provider = ?1 AND disabled_cause IS NULL \
             ORDER BY updated_at DESC LIMIT 1",
        )
        .map_err(|e| format!("prepare omp credential query: {e}"))?;
    let mut rows = stmt
        .query(rusqlite::params![provider])
        .map_err(|e| format!("query omp credential: {e}"))?;
    match rows.next().map_err(|e| format!("read omp credential row: {e}"))? {
        Some(row) => {
            let data: String = row
                .get(0)
                .map_err(|e| format!("read credential data column: {e}"))?;
            Ok(Some(data))
        }
        None => Ok(None),
    }
}
/// 读取 quota provider 使用的环境变量。仅返回非空值,不执行 shell 命令。
#[tauri::command]
pub fn quota_env_value(name: String) -> Option<String> {
    let key = name.trim();
    if key.is_empty() {
        return None;
    }
    std::env::var(key).ok().filter(|value| !value.trim().is_empty())
}