//! SFTP 写侧操作 —— 写文本(乐观并发)/ mkdir / rename / 递归 delete。
//! 自 sftp.rs 拆出(文件规模铁则);通道缓存与注册表留在 sftp.rs。

use std::sync::Arc;

use russh_sftp::client::SftpSession;

use super::sftp::{global_sftp, ssh_registry, SftpEntry, SftpWriteOutcome};
use super::sftp_ops::remote_entry;
use super::sftp_path::{
    is_not_found_error, is_session_closed_error, is_write_conflict, join_remote_path,
    normalize_remote_path, remote_parent_path,
};
use super::SshRegistry;

/// 写远端文本;带 expected_mtime/expected_size 时先 stat 比对,冲突返回
/// Conflict(编辑器弹覆盖确认),不覆盖不报错。
pub async fn write_text(
    session_id: &str,
    path: &str,
    content: &str,
    expected_mtime: Option<u64>,
    expected_size: Option<u64>,
) -> Result<SftpWriteOutcome, String> {
    let registry = ssh_registry();
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
            global_sftp().invalidate(session_id);
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
    let cached = global_sftp().session_for(registry, session_id).await?;
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
    let registry = ssh_registry();
    let target = normalize_remote_path(path);
    let cached = global_sftp().session_for(&registry, session_id).await?;
    let session = cached.lock().await;
    session
        .create_dir(target.clone())
        .await
        .map_err(|error| format!("远端目录创建失败: {error}"))?;
    remote_entry(&session, &target).await
}

pub async fn rename(session_id: &str, from: &str, to: &str) -> Result<SftpEntry, String> {
    let registry = ssh_registry();
    let from = normalize_remote_path(from);
    let to = normalize_remote_path(to);
    let cached = global_sftp().session_for(&registry, session_id).await?;
    let session = cached.lock().await;
    session
        .rename(from, to.clone())
        .await
        .map_err(|error| format!("远端重命名失败: {error}"))?;
    remote_entry(&session, &to).await
}

/// 删除远端路径;目录必须 recursive:文件先删、目录自底向上。
pub async fn delete(session_id: &str, path: &str, recursive: bool) -> Result<(), String> {
    let registry = ssh_registry();
    let target = normalize_remote_path(path);
    let cached = global_sftp().session_for(&registry, session_id).await?;
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
