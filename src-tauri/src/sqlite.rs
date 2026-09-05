//! 通用只读 sqlite 查询 —— CLI 私有库(如凭据存储)的代读原语。
//!
//! 设计边界:JS 无法解析 sqlite,由 Rust 代读;但内核不理解任何 CLI 的
//! 库路径/表结构/SQL —— 调用方(插件侧,知识沉淀在 cli-shared)自带
//! dbPath 与语句,内核只保证两件事:
//! - 只读打开(SQLITE_OPEN_READ_ONLY,写语句在连接层即被拒绝);
//! - 参数化绑定(?N 占位,防注入)。
//!
//! 库不存在返回空行集,不抛错(调用方据此显示空态)。

use serde::Serialize;

/// 单行结果:每列一个 JSON 值(NULL → null,TEXT/INTEGER/REAL 原样标量化)。
#[derive(Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum SqliteValue {
    Null,
    Text(String),
    Int(i64),
    Real(f64),
}

fn column_value(row: &rusqlite::Row, idx: usize) -> Result<SqliteValue, rusqlite::Error> {
    match row.get_ref(idx)? {
        rusqlite::types::ValueRef::Null => Ok(SqliteValue::Null),
        rusqlite::types::ValueRef::Integer(v) => Ok(SqliteValue::Int(v)),
        rusqlite::types::ValueRef::Real(v) => Ok(SqliteValue::Real(v)),
        rusqlite::types::ValueRef::Text(t) => {
            Ok(SqliteValue::Text(String::from_utf8_lossy(t).to_string()))
        }
        rusqlite::types::ValueRef::Blob(b) => {
            Ok(SqliteValue::Text(String::from_utf8_lossy(b).to_string()))
        }
    }
}

/// 只读查询 db_path 的 sqlite 库,参数化执行 sql,返回全部行(逐列标量化)。
/// 库不存在 = Ok(vec![]);打开/语法/绑定错误 = Err(带上下文的中文消息)。
#[tauri::command]
pub fn sqlite_query(
    db_path: String,
    sql: String,
    params: Vec<String>,
) -> Result<Vec<Vec<SqliteValue>>, String> {
    if !std::path::Path::new(&db_path).exists() {
        return Ok(Vec::new());
    }
    let conn =
        rusqlite::Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("open sqlite (readonly): {e}"))?;
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("prepare sqlite: {e}"))?;
    let mut rows = stmt
        .query(rusqlite::params_from_iter(params.iter()))
        .map_err(|e| format!("query sqlite: {e}"))?;
    let mut out: Vec<Vec<SqliteValue>> = Vec::new();
    while let Some(row) = rows.next().map_err(|e| format!("read sqlite row: {e}"))? {
        let cols = row.as_ref().column_count();
        let mut line = Vec::with_capacity(cols);
        for idx in 0..cols {
            line.push(column_value(row, idx).map_err(|e| format!("read column {idx}: {e}"))?);
        }
        out.push(line);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readonly_rejects_write() {
        let dir = std::env::temp_dir().join(format!("tmd-cli-sqlite-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("t.db");
        let _ = std::fs::remove_file(&db);
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute("CREATE TABLE t (a TEXT)", []).unwrap();
        conn.execute("INSERT INTO t VALUES ('x')", []).unwrap();
        drop(conn);

        let rows = sqlite_query(
            db.to_string_lossy().to_string(),
            "SELECT a FROM t".into(),
            vec![],
        )
        .unwrap();
        assert_eq!(rows, vec![vec![SqliteValue::Text("x".into())]]);

        // 写语句在只读连接上必须被拒
        let err = sqlite_query(
            db.to_string_lossy().to_string(),
            "INSERT INTO t VALUES ('y')".into(),
            vec![],
        )
        .unwrap_err();
        assert!(err.contains("sqlite"), "{err}");

        // 参数化绑定
        let rows = sqlite_query(
            db.to_string_lossy().to_string(),
            "SELECT a FROM t WHERE a = ?1".into(),
            vec!["x".into()],
        )
        .unwrap();
        assert_eq!(rows.len(), 1);

        let _ = std::fs::remove_file(&db);
        let _ = std::fs::remove_dir(&dir);
    }

    #[test]
    fn missing_db_returns_empty() {
        let rows = sqlite_query(
            "/nonexistent/tmd-cli-should-not-exist.db".into(),
            "SELECT 1".into(),
            vec![],
        )
        .unwrap();
        assert!(rows.is_empty());
    }
}
