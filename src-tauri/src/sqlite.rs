//! 通用只读 sqlite 查询 —— CLI 私有库(如凭据存储)的代读原语。
//!
//! 设计边界:JS 无法解析 sqlite,由 Rust 代读;但内核不理解任何 CLI 的
//! 库路径/表结构/SQL —— 调用方(插件侧,知识沉淀在 cli-shared)自带
//! dbPath 与语句,内核只保证两件事:
//! - READ_WRITE 打开 + query_only 连接:WAL 库的未 checkpoint 数据只在
//!   -wal 里,READ_ONLY 连接无法重放 WAL 会看不到最新行;query_only 在
//!   连接层保证语句级只读(写语句被拒绝),重放所需的写句柄不落成数据写;
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
    // 读写打开 + query_only:WAL 库的未 checkpoint 数据只在 -wal 里,
    // READ_ONLY 连接无法重放 WAL 会看不到最新行(memory 池 0 条的根因);
    // query_only 在连接层保证语句级只读,重放与 shm 交互需要写句柄。
    let conn = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE,
    )
    .map_err(|e| format!("open sqlite: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_millis(3000))
        .map_err(|e| format!("set sqlite busy timeout: {e}"))?;
    conn.pragma_update(None, "query_only", true)
        .map_err(|e| format!("enable sqlite query_only: {e}"))?;
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

/// 通用参数化 sqlite 写执行(单条语句)—— CLI 私有库的代写原语。
///
/// 设计边界同 sqlite_query:内核零 CLI 知识,调用方(插件侧)自带 dbPath/语句/参数。
/// 与只读通道的差异:
/// - 写打开(READ_WRITE,不 CREATE;库不存在 = Err,与读通道「不存在=空集」语义区分);
/// - 连接上启用 PRAGMA foreign_keys,让 CLI 库自带的 ON DELETE CASCADE 约束生效
///   (如单库 CLI 删会话行的级联清理),插件侧无需自带子表删除序;
/// - 3s busy 超时,避免与 CLI 进程的写锁碰撞直接 SQLITE_BUSY。
///
/// 低频用户动作(如「删除会话」),同步命令开销可忽略。
#[tauri::command]
pub fn sqlite_execute(db_path: String, sql: String, params: Vec<String>) -> Result<(), String> {
    let conn = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE,
    )
    .map_err(|e| format!("open sqlite (rw): {e}"))?;
    conn.busy_timeout(std::time::Duration::from_millis(3000))
        .map_err(|e| format!("set sqlite busy timeout: {e}"))?;
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(|e| format!("enable sqlite foreign_keys: {e}"))?;
    conn.execute(&sql, rusqlite::params_from_iter(params.iter()))
        .map_err(|e| format!("execute sqlite: {e}"))?;
    Ok(())
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
    fn query_sees_uncheckpointed_wal_rows() {
        // 回归:omp 场景 —— 写入方持 WAL 连接不 checkpoint,只读代读必须能
        // 看到未合并行(READ_ONLY 连接重放不了 WAL,曾致 memory 池 0 条)。
        let dir = std::env::temp_dir().join(format!("tmd-cli-sqlite-wal-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("wal.db");
        let _ = std::fs::remove_file(&db);
        let writer = rusqlite::Connection::open(&db).unwrap();
        writer.pragma_update(None, "journal_mode", "WAL").unwrap();
        writer.execute("CREATE TABLE m (c TEXT)", []).unwrap();
        writer
            .execute("INSERT INTO m VALUES ('fresh')", [])
            .unwrap();
        // writer 保持打开(数据停留在 -wal,未 checkpoint)

        let rows = sqlite_query(
            db.to_string_lossy().to_string(),
            "SELECT c FROM m".into(),
            vec![],
        )
        .unwrap();
        assert_eq!(rows, vec![vec![SqliteValue::Text("fresh".into())]]);

        drop(writer);
        let _ = std::fs::remove_dir_all(&dir);
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

    #[test]
    fn execute_deletes_with_fk_cascade_and_missing_db_errs() {
        let dir = std::env::temp_dir().join(format!("tmd-cli-sqlite-exec-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("t.db");
        let _ = std::fs::remove_file(&db);
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute("CREATE TABLE parent (id TEXT PRIMARY KEY)", [])
            .unwrap();
        conn.execute(
            "CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL \
             REFERENCES parent(id) ON DELETE CASCADE)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO parent VALUES ('p1')", [])
            .unwrap();
        conn.execute("INSERT INTO child VALUES ('c1', 'p1')", [])
            .unwrap();
        drop(conn);

        // 参数化删除父行:FK 级联清子行(opencode 单库会话删除的形态)
        sqlite_execute(
            db.to_string_lossy().to_string(),
            "DELETE FROM parent WHERE id = ?1".into(),
            vec!["p1".into()],
        )
        .unwrap();
        let rows = sqlite_query(
            db.to_string_lossy().to_string(),
            "SELECT (SELECT count(*) FROM parent) + (SELECT count(*) FROM child)".into(),
            vec![],
        )
        .unwrap();
        assert_eq!(rows, vec![vec![SqliteValue::Int(0)]]);

        // 库不存在 = Err(写目标必须存在,不静默建库)
        let err = sqlite_execute(
            "/nonexistent/tmd-cli-exec-missing.db".into(),
            "DELETE FROM t".into(),
            vec![],
        )
        .unwrap_err();
        assert!(err.contains("open sqlite"), "{err}");

        let _ = std::fs::remove_file(&db);
        let _ = std::fs::remove_dir(&dir);
    }
}
