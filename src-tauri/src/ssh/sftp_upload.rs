//! SFTP 上传 —— 本地树规划 + 流式上传(64KB 缓冲、进度事件、可取消)。
//! 自 sftp_transfer.rs 拆出(文件规模铁则);传输入口与状态广播留在 sftp_transfer.rs。

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::sftp::{ensure_remote_dir, TRANSFER_BUFFER_BYTES};
use super::sftp_path::{join_remote_path, normalize_remote_path};
use super::sftp_transfer::{is_cancelled, running_state, sftp_session};
use super::sftp_transfer_state::{report, SftpTransferState};

// run_upload 供 sftp_transfer::start_transfer 后台任务调用。
// ---- 上传 ----

struct LocalTreePlan {
    dirs: Vec<String>,
    files: Vec<LocalFilePlan>,
    total_bytes: u64,
}

struct LocalFilePlan {
    abs: std::path::PathBuf,
    rel: String,
}

async fn plan_local_tree(root: &std::path::Path) -> Result<LocalTreePlan, String> {
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    let mut total_bytes = 0u64;
    let mut queue = vec![(root.to_path_buf(), String::new())];
    while let Some((dir, rel)) = queue.pop() {
        let mut entries = tokio::fs::read_dir(&dir)
            .await
            .map_err(|error| format!("读取本地目录失败: {error}"))?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|error| format!("读取本地目录失败: {error}"))?
        {
            let name = entry.file_name().to_string_lossy().to_string();
            let child_rel = if rel.is_empty() {
                name.clone()
            } else {
                format!("{rel}/{name}")
            };
            let metadata = entry
                .metadata()
                .await
                .map_err(|error| format!("读取本地元数据失败: {error}"))?;
            if metadata.is_dir() {
                dirs.push(child_rel.clone());
                queue.push((entry.path(), child_rel));
            } else {
                total_bytes = total_bytes.saturating_add(metadata.len());
                files.push(LocalFilePlan {
                    abs: entry.path(),
                    rel: child_rel,
                });
            }
        }
    }
    Ok(LocalTreePlan {
        dirs,
        files,
        total_bytes,
    })
}

pub(crate) async fn run_upload(
    session_id: &str,
    key: &str,
    source_path: &str,
    target_path: &str,
    recursive: bool,
    cancelled: &Arc<AtomicBool>,
) -> Result<SftpTransferState, String> {
    let mut state = SftpTransferState {
        id: key.rsplit(':').next().unwrap_or_default().to_string(),
        session_id: session_id.to_string(),
        direction: "upload".to_string(),
        status: "running".to_string(),
        source_path: source_path.to_string(),
        target_path: target_path.to_string(),
        bytes_done: 0,
        bytes_total: 0,
        files_done: 0,
        files_total: 0,
        error: None,
    };
    let local = std::path::PathBuf::from(source_path.trim());
    let metadata = tokio::fs::symlink_metadata(&local)
        .await
        .map_err(|error| format!("读取本地路径失败: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Err("上传不支持本地符号链接".to_string());
    }

    let sftp = sftp_session(session_id).await?;
    let session = sftp.lock().await;

    if metadata.is_dir() {
        if !recursive {
            return Err("上传目录需要递归确认".to_string());
        }
        let plan = plan_local_tree(&local).await?;
        state.bytes_total = plan.total_bytes;
        state.files_total = plan.files.len() as u32;
        report(key, &state);
        let remote_root = normalize_remote_path(target_path);
        for dir in &plan.dirs {
            is_cancelled(cancelled)?;
            /* 持会话锁内建目录:复用持有的会话,不得走公共入口(重入死锁)。 */
            ensure_remote_dir(&session, &join_remote_path(&remote_root, dir)).await?;
        }
        for file in &plan.files {
            is_cancelled(cancelled)?;
            upload_one_file(
                key,
                &session,
                &file.abs,
                &join_remote_path(&remote_root, &file.rel),
                &mut state,
                cancelled,
            )
            .await?;
            state.files_done += 1;
            report(key, &state);
        }
    } else {
        state.bytes_total = metadata.len();
        state.files_total = 1;
        running_state(&mut state);
        report(key, &state);
        upload_one_file(
            key,
            &session,
            &local,
            &normalize_remote_path(target_path),
            &mut state,
            cancelled,
        )
        .await?;
        state.files_done = 1;
    }
    Ok(state)
}

async fn upload_one_file(
    key: &str,
    session: &russh_sftp::client::SftpSession,
    local: &std::path::Path,
    remote: &str,
    state: &mut SftpTransferState,
    cancelled: &Arc<AtomicBool>,
) -> Result<(), String> {
    let mut source = tokio::fs::File::open(local)
        .await
        .map_err(|error| format!("打开本地文件失败: {error}"))?;
    let mut target = session
        .create(remote.to_string())
        .await
        .map_err(|error| format!("创建远端文件失败: {error}"))?;
    let mut buffer = vec![0u8; TRANSFER_BUFFER_BYTES];
    loop {
        is_cancelled(cancelled)?;
        let read = source
            .read(&mut buffer)
            .await
            .map_err(|error| format!("读取本地文件失败: {error}"))?;
        if read == 0 {
            break;
        }
        target
            .write_all(&buffer[..read])
            .await
            .map_err(|error| format!("写入远端文件失败: {error}"))?;
        state.bytes_done = state.bytes_done.saturating_add(read as u64);
        report(key, state);
    }
    target
        .shutdown()
        .await
        .map_err(|error| format!("关闭远端文件失败: {error}"))?;
    Ok(())
}
