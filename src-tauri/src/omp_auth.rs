//! omp CLI 凭据读取 —— agent.db(auth_credentials 表)只读访问。
//!
//! omp 凭据存 sqlite(~/.omp/agent/agent.db),JS 无法解析,由 Rust 代读。
//! 这是 CLI 私有存储知识,独立成模块:quota.rs 保持"通用 HTTP 代理 +
//! 只读环境变量"的纯粹职责(见 docs/architecture/01-overview.md §7)。

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
    let conn =
        rusqlite::Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
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
    match rows
        .next()
        .map_err(|e| format!("read omp credential row: {e}"))?
    {
        Some(row) => {
            let data: String = row
                .get(0)
                .map_err(|e| format!("read credential data column: {e}"))?;
            Ok(Some(data))
        }
        None => Ok(None),
    }
}
/// 列出 omp CLI 已登录的全部供应商 id(auth_credentials 表,未禁用)。
/// 用于欢迎页"已登录供应商"盘点;库不存在/查询失败返回空表,不抛错。
#[tauri::command]
pub fn omp_auth_providers() -> Vec<String> {
    let db_path = dirs::home_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(".omp/agent/agent.db");
    if !db_path.exists() {
        return Vec::new();
    }
    let Ok(conn) =
        rusqlite::Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return Vec::new();
    };
    let Ok(mut stmt) = conn.prepare(
        "SELECT DISTINCT provider FROM auth_credentials \
         WHERE disabled_cause IS NULL ORDER BY provider",
    ) else {
        return Vec::new();
    };
    let rows = stmt.query_map([], |row| row.get::<_, String>(0));
    match rows {
        Ok(mapped) => mapped.filter_map(Result::ok).collect(),
        Err(_) => Vec::new(),
    }
}
