//! SFTP 子系统 —— 在终端会话的已认证连接上开 sftp channel(不重认证)。list/stat/读写文本(乐观并发)/
//! mkdir/rename/递归 delete;通道按连接代际缓存,重连后自动失效重开。
//! 路径原语见 sftp_path.rs;传输(上传/下载/进度/取消)见 sftp_transfer*.rs。

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use tauri::Emitter;

use super::sftp_path::{
    is_not_found_error, is_session_closed_error, is_write_conflict, join_remote_path,
    normalize_remote_path, remote_basename, remote_parent_path,
};
use super::SshRegistry;

pub(crate) const TRANSFER_BUFFER_BYTES: usize = 64 * 1024;
const READ_TEXT_DEFAULT_BYTES: usize = 200 * 1024;
/// 与 fs.rs 文本编辑上限同档:编辑器可打开的远端文件尺寸。
const READ_TEXT_MAX_BYTES: usize = 3 * 1024 * 1024;
/// SFTP 事件通道(`ssh://sftp`),载荷 {kind, transfer}。
pub(crate) const SFTP_EVENT: &str = "ssh://sftp";

/// 远端条目(树/编辑器/传输共用)。
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub path: String,
    pub name: String,
    /// "dir" | "file"。
    pub kind: String,
    pub size_bytes: u64,
    /// ms epoch(SFTP 秒粒度 × 1000)。
    pub mtime: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpReadText {
    pub path: String,
    pub content: String,
    pub offset: u64,
    pub bytes_read: usize,
    pub size_bytes: u64,
    pub truncated: bool,
    pub entry: SftpEntry,
}

/// 写回结果;conflict 变体携带当前条目供编辑器弹覆盖确认。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "action")]
pub enum SftpWriteOutcome {
    Written { entry: SftpEntry },
    Conflict { entry: Option<SftpEntry> },
}

/// 进程级 SFTP 注册表:会话 → (代际, channel)。
pub struct SftpRegistry {
    sessions: Mutex<HashMap<String, CachedSftp>>,
}

struct CachedSftp {
    connection_id: usize,
    session: Arc<tokio::sync::Mutex<SftpSession>>,
}

static SFTP: std::sync::LazyLock<SftpRegistry> = std::sync::LazyLock::new(|| SftpRegistry {
    sessions: Mutex::new(HashMap::new()),
});

pub(crate) fn global_sftp() -> &'static SftpRegistry {
    &SFTP
}

/// 会话终局级联:弃通道缓存、取消在途传输。
pub fn close_session(session_id: &str) {
    SFTP.sessions.lock().remove(session_id);
    super::sftp_transfer_state::cancel_session_transfers(session_id);
}

impl SftpRegistry {
    /// 取(或按代际重建)会话的 SFTP 通道。
    pub(crate) async fn session_for(
        &self,
        registry: &Arc<SshRegistry>,
        session_id: &str,
    ) -> Result<Arc<tokio::sync::Mutex<SftpSession>>, String> {
        let entry = registry.entry(session_id)?;
        if entry.runtime.status() != super::STATUS_CONNECTED {
            return Err("SSH 连接未就绪".to_string());
        }
        let connection_id = entry.runtime.current_connection_id();
        if let Some(cached) = SFTP
            .sessions
            .lock()
            .get(session_id)
            .filter(|cached| cached.connection_id == connection_id)
            .map(|cached| Arc::clone(&cached.session))
        {
            return Ok(cached);
        }
        let handle = entry
            .runtime
            .current_handle()
            .await
            .ok_or_else(|| "SSH 连接不可用".to_string())?;
        let channel = handle
            .channel_open_session()
            .await
            .map_err(|error| format!("SFTP 通道打开失败: {error}"))?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|error| format!("SFTP subsystem 请求失败: {error}"))?;
        let session = SftpSession::new(channel.into_stream())
            .await
            .map_err(|error| format!("SFTP 会话建立失败: {error}"))?;
        let cached = Arc::new(tokio::sync::Mutex::new(session));
        SFTP.sessions.lock().insert(
            session_id.to_string(),
            CachedSftp {
                connection_id,
                session: Arc::clone(&cached),
            },
        );
        Ok(cached)
    }
}

fn registry() -> Arc<SshRegistry> {
    super::global_ssh().expect("SSH 引擎未装配")
}

async fn remote_entry(session: &SftpSession, path: &str) -> Result<SftpEntry, String> {
    let path = normalize_remote_path(path);
    let metadata = session
        .metadata(path.clone())
        .await
        .map_err(|error| format!("远端 stat 失败: {error}"))?;
    Ok(SftpEntry {
        name: remote_basename(&path).unwrap_or_else(|| path.clone()),
        path,
        kind: if metadata.is_dir() { "dir" } else { "file" }.to_string(),
        size_bytes: metadata.size.unwrap_or(0),
        mtime: u64::from(metadata.mtime.unwrap_or(0)) * 1000,
    })
}

// ---- 操作入口(命令层调用;连接失效自动重试一次) ----

pub async fn list(session_id: &str, path: Option<String>) -> Result<Vec<SftpEntry>, String> {
    let registry = registry();
    let root = normalize_remote_path(&path.unwrap_or_else(|| ".".to_string()));
    match list_once(&registry, session_id, &root).await {
        Ok(entries) => Ok(entries),
        Err(error) if is_session_closed_error(&error) => {
            SFTP.sessions.lock().remove(session_id);
            list_once(&registry, session_id, &root).await
        }
        Err(error) => Err(error),
    }
}

async fn list_once(
    registry: &Arc<SshRegistry>,
    session_id: &str,
    path: &str,
) -> Result<Vec<SftpEntry>, String> {
    let cached = SFTP.session_for(registry, session_id).await?;
    let session = cached.lock().await;
    let dir = session
        .read_dir(path.to_string())
        .await
        .map_err(|error| format!("远端目录读取失败: {error}"))?;
    let mut entries = Vec::new();
    for item in dir {
        let name = item.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let child = join_remote_path(path, &name);
        let metadata = item.metadata();
        entries.push(SftpEntry {
            name,
            path: child,
            kind: if metadata.is_dir() { "dir" } else { "file" }.to_string(),
            size_bytes: metadata.size.unwrap_or(0),
            mtime: u64::from(metadata.mtime.unwrap_or(0)) * 1000,
        });
    }
    /* 目录排前、同内按名排(files 插件树同款观感)。 */
    entries.sort_by(|a, b| match (a.kind == b.kind, a.kind == "dir") {
        (true, true) => a.name.cmp(&b.name),
        (false, true) => std::cmp::Ordering::Less,
        (false, false) => std::cmp::Ordering::Greater,
        (true, false) => a.name.cmp(&b.name),
    });
    Ok(entries)
}

pub async fn stat(session_id: &str, path: &str) -> Result<Option<SftpEntry>, String> {
    let registry = registry();
    let target = normalize_remote_path(path);
    let cached = SFTP.session_for(&registry, session_id).await?;
    let session = cached.lock().await;
    match remote_entry(&session, &target).await {
        Ok(entry) => Ok(Some(entry)),
        Err(error) if is_not_found_error(&error) => Ok(None),
        Err(error) => Err(error),
    }
}

/// 读远端文本(分页 offset + 上限;截断页尾部不完整 UTF-8 序列丢弃,下页重读)。
pub async fn read_text(
    session_id: &str,
    path: &str,
    offset: Option<u64>,
    max_bytes: Option<usize>,
) -> Result<SftpReadText, String> {
    let registry = registry();
    let target = normalize_remote_path(path);
    let cached = SFTP.session_for(&registry, session_id).await?;
    let session = cached.lock().await;
    let entry = remote_entry(&session, &target).await?;
    let offset = offset.unwrap_or(0).min(entry.size_bytes);
    let limit = max_bytes
        .unwrap_or(READ_TEXT_DEFAULT_BYTES)
        .min(READ_TEXT_MAX_BYTES);
    let mut file = session
        .open(target.clone())
        .await
        .map_err(|error| format!("远端文件打开失败: {error}"))?;
    use tokio::io::{AsyncReadExt, AsyncSeekExt};
    if offset > 0 {
        file.seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|error| format!("远端文件定位失败: {error}"))?;
    }
    let mut buffer = vec![0u8; limit + 4];
    let read = file
        .read(&mut buffer)
        .await
        .map_err(|error| format!("远端文件读取失败: {error}"))?;
    buffer.truncate(read);
    let end = offset + read as u64;
    let truncated = end < entry.size_bytes;
    let mut cut = buffer.len();
    if truncated {
        while cut > 0 && std::str::from_utf8(&buffer[..cut]).is_err() {
            cut -= 1;
        }
    }
    let content = String::from_utf8_lossy(&buffer[..cut]).to_string();
    Ok(SftpReadText {
        path: entry.path.clone(),
        content,
        offset,
        bytes_read: cut,
        size_bytes: entry.size_bytes,
        truncated,
        entry,
    })
}

/// 写远端文本;带 expected_mtime/expected_size 时先 stat 比对,冲突返回
/// Conflict(编辑器弹覆盖确认),不覆盖不报错。
pub async fn write_text(
    session_id: &str,
    path: &str,
    content: &str,
    expected_mtime: Option<u64>,
    expected_size: Option<u64>,
) -> Result<SftpWriteOutcome, String> {
    let registry = registry();
    let target = normalize_remote_path(path);
    match write_text_once(
        &registry,
        session_id,
        &target,
        content,
        expected_mtime,
        expected_size,
    )
    .await
    {
        Ok(outcome) => Ok(outcome),
        Err(error) if is_session_closed_error(&error) => {
            SFTP.sessions.lock().remove(session_id);
            write_text_once(
                &registry,
                session_id,
                &target,
                content,
                expected_mtime,
                expected_size,
            )
            .await
        }
        Err(error) => Err(error),
    }
}

async fn write_text_once(
    registry: &Arc<SshRegistry>,
    session_id: &str,
    target: &str,
    content: &str,
    expected_mtime: Option<u64>,
    expected_size: Option<u64>,
) -> Result<SftpWriteOutcome, String> {
    let cached = SFTP.session_for(registry, session_id).await?;
    let session = cached.lock().await;
    if expected_mtime.is_some() || expected_size.is_some() {
        match remote_entry(&session, target).await {
            Ok(current) => {
                if is_write_conflict(expected_mtime, expected_size, &current) {
                    return Ok(SftpWriteOutcome::Conflict {
                        entry: Some(current),
                    });
                }
            }
            Err(error) if is_not_found_error(&error) => {
                /* 远端已被删:同样走 conflict,由用户决定重建。 */
                return Ok(SftpWriteOutcome::Conflict { entry: None });
            }
            Err(error) => return Err(error),
        }
    }
    if let Some(parent) = remote_parent_path(target) {
        ensure_remote_dir_all(&session, &parent).await?;
    }
    use tokio::io::AsyncWriteExt;
    let mut file = session
        .create(target.to_string())
        .await
        .map_err(|error| format!("远端文件创建失败: {error}"))?;
    file.write_all(content.as_bytes())
        .await
        .map_err(|error| format!("远端文件写入失败: {error}"))?;
    file.shutdown()
        .await
        .map_err(|error| format!("远端文件关闭失败: {error}"))?;
    let entry = remote_entry(&session, target).await?;
    Ok(SftpWriteOutcome::Written { entry })
}

async fn ensure_remote_dir_all(session: &SftpSession, path: &str) -> Result<(), String> {
    let path = normalize_remote_path(path);
    if path == "." || path == "/" {
        return Ok(());
    }
    let mut current = if path.starts_with('/') {
        "/".to_string()
    } else {
        ".".to_string()
    };
    for part in path
        .trim_matches('/')
        .split('/')
        .filter(|part| !part.is_empty())
    {
        current = join_remote_path(&current, part);
        match session.create_dir(current.clone()).await {
            Ok(_) => {}
            Err(_) if session.try_exists(current.clone()).await.unwrap_or(false) => {}
            Err(error) => return Err(format!("远端目录创建失败: {error}")),
        }
    }
    Ok(())
}

/// 持锁建单级目录(已存在视为成功)—— 传输任务持有会话锁时用,不得走公共 mkdir。
pub(crate) async fn ensure_remote_dir(session: &SftpSession, path: &str) -> Result<(), String> {
    match session.create_dir(normalize_remote_path(path)).await {
        Ok(_) => Ok(()),
        Err(_)
            if session
                .try_exists(normalize_remote_path(path))
                .await
                .unwrap_or(false) =>
        {
            Ok(())
        }
        Err(error) => Err(format!("远端目录创建失败: {error}")),
    }
}

pub async fn mkdir(session_id: &str, path: &str) -> Result<SftpEntry, String> {
    let registry = registry();
    let target = normalize_remote_path(path);
    let cached = SFTP.session_for(&registry, session_id).await?;
    let session = cached.lock().await;
    session
        .create_dir(target.clone())
        .await
        .map_err(|error| format!("远端目录创建失败: {error}"))?;
    remote_entry(&session, &target).await
}

pub async fn rename(session_id: &str, from: &str, to: &str) -> Result<SftpEntry, String> {
    let registry = registry();
    let from = normalize_remote_path(from);
    let to = normalize_remote_path(to);
    let cached = SFTP.session_for(&registry, session_id).await?;
    let session = cached.lock().await;
    session
        .rename(from, to.clone())
        .await
        .map_err(|error| format!("远端重命名失败: {error}"))?;
    remote_entry(&session, &to).await
}

/// 删除远端路径;目录必须 recursive:文件先删、目录自底向上。
pub async fn delete(session_id: &str, path: &str, recursive: bool) -> Result<(), String> {
    let registry = registry();
    let target = normalize_remote_path(path);
    let cached = SFTP.session_for(&registry, session_id).await?;
    let session = cached.lock().await;
    let metadata = session
        .metadata(target.clone())
        .await
        .map_err(|error| format!("远端 stat 失败: {error}"))?;
    if !metadata.is_dir() {
        session
            .remove_file(target)
            .await
            .map_err(|error| format!("远端删除失败: {error}"))?;
        return Ok(());
    }
    if !recursive {
        return Err("删除远端目录需要递归确认".to_string());
    }
    let mut dirs = vec![target.clone()];
    let mut files = Vec::new();
    let mut idx = 0;
    while idx < dirs.len() {
        let dir = dirs[idx].clone();
        idx += 1;
        for entry in session
            .read_dir(dir.clone())
            .await
            .map_err(|error| format!("远端目录读取失败: {error}"))?
        {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let child = join_remote_path(&dir, &name);
            if entry.metadata().is_dir() {
                dirs.push(child);
            } else {
                files.push(child);
            }
        }
    }
    for file in files {
        session
            .remove_file(file)
            .await
            .map_err(|error| format!("远端删除失败: {error}"))?;
    }
    for dir in dirs.into_iter().rev() {
        session
            .remove_dir(dir)
            .await
            .map_err(|error| format!("远端目录删除失败: {error}"))?;
    }
    Ok(())
}

/// 广播传输事件(progress/done/failed/cancelled;状态表在 sftp_transfer_state)。
pub(crate) fn broadcast_transfer(
    kind: &str,
    transfer: &super::sftp_transfer_state::SftpTransferState,
) {
    let Some(app) = super::global_app() else {
        return;
    };
    let _ = app.emit(
        SFTP_EVENT,
        SftpEventPayload {
            kind: kind.to_string(),
            transfer: transfer.clone(),
        },
    );
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SftpEventPayload {
    kind: String,
    transfer: super::sftp_transfer_state::SftpTransferState,
}
