//! SFTP 读侧操作 —— 远端条目解析 / list / stat / 读文本(分页 + UTF-8 截断)。
//! 自 sftp.rs 拆出(文件规模铁则);通道缓存与注册表留在 sftp.rs。

use std::sync::Arc;

use russh_sftp::client::SftpSession;

use super::sftp::{global_sftp, ssh_registry, SftpEntry, SftpReadText};
use super::sftp_path::{
    is_not_found_error, is_session_closed_error, join_remote_path, normalize_remote_path,
    remote_basename,
};
use super::SshRegistry;

const READ_TEXT_DEFAULT_BYTES: usize = 200 * 1024;
/// 与 fs.rs 文本编辑上限同档:编辑器可打开的远端文件尺寸。
const READ_TEXT_MAX_BYTES: usize = 3 * 1024 * 1024;

pub(crate) async fn remote_entry(session: &SftpSession, path: &str) -> Result<SftpEntry, String> {
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
    let registry = ssh_registry();
    let root = normalize_remote_path(&path.unwrap_or_else(|| ".".to_string()));
    match list_once(&registry, session_id, &root).await {
        Ok(entries) => Ok(entries),
        Err(error) if is_session_closed_error(&error) => {
            global_sftp().invalidate(session_id);
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
    let cached = global_sftp().session_for(registry, session_id).await?;
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
    let registry = ssh_registry();
    let target = normalize_remote_path(path);
    let cached = global_sftp().session_for(&registry, session_id).await?;
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
    let registry = ssh_registry();
    let target = normalize_remote_path(path);
    let cached = global_sftp().session_for(&registry, session_id).await?;
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
