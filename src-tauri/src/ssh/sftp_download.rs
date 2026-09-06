//! SFTP 下载 —— 远端树规划 + 流式下载(64KB 缓冲、进度事件、可取消)。
//! 自 sftp_transfer.rs 拆出(文件规模铁则);传输入口与状态广播留在 sftp_transfer.rs。

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::sftp::TRANSFER_BUFFER_BYTES;
use super::sftp_path::{join_remote_path, normalize_remote_path};
use super::sftp_transfer::{is_cancelled, sftp_session};
use super::sftp_transfer_state::{report, SftpTransferState};

// run_download 供 sftp_transfer::start_transfer 后台任务调用。
// ---- 下载 ----

struct RemoteTreePlan {
    dirs: Vec<String>,
    files: Vec<RemoteFilePlan>,
    total_bytes: u64,
}

struct RemoteFilePlan {
    path: String,
    rel: String,
}

async fn plan_remote_tree(
    session: &russh_sftp::client::SftpSession,
    root: &str,
) -> Result<RemoteTreePlan, String> {
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    let mut total_bytes = 0u64;
    let mut queue = vec![(root.to_string(), String::new())];
    while let Some((dir, rel)) = queue.pop() {
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
            let child_rel = if rel.is_empty() {
                name.clone()
            } else {
                format!("{rel}/{name}")
            };
            let metadata = entry.metadata();
            if metadata.is_dir() {
                dirs.push(child_rel.clone());
                queue.push((child, child_rel));
            } else {
                total_bytes = total_bytes.saturating_add(metadata.size.unwrap_or(0));
                files.push(RemoteFilePlan {
                    path: child,
                    rel: child_rel,
                });
            }
        }
    }
    Ok(RemoteTreePlan {
        dirs,
        files,
        total_bytes,
    })
}

pub(crate) async fn run_download(
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
        direction: "download".to_string(),
        status: "running".to_string(),
        source_path: source_path.to_string(),
        target_path: target_path.to_string(),
        bytes_done: 0,
        bytes_total: 0,
        files_done: 0,
        files_total: 0,
        error: None,
    };
    let remote = normalize_remote_path(source_path);
    let sftp = sftp_session(session_id).await?;
    let session = sftp.lock().await;
    let root_meta = session
        .metadata(remote.clone())
        .await
        .map_err(|error| format!("远端 stat 失败: {error}"))?;
    let local_root = std::path::PathBuf::from(target_path.trim());
    if root_meta.is_dir() {
        if !recursive {
            return Err("下载目录需要递归确认".to_string());
        }
        let plan = plan_remote_tree(&session, &remote).await?;
        state.bytes_total = plan.total_bytes;
        state.files_total = plan.files.len() as u32;
        report(key, &state);
        tokio::fs::create_dir_all(&local_root)
            .await
            .map_err(|error| format!("创建本地目录失败: {error}"))?;
        for dir in &plan.dirs {
            is_cancelled(cancelled)?;
            tokio::fs::create_dir_all(local_root.join(dir))
                .await
                .map_err(|error| format!("创建本地目录失败: {error}"))?;
        }
        for file in &plan.files {
            is_cancelled(cancelled)?;
            download_one_file(
                key,
                &session,
                &file.path,
                &local_root.join(&file.rel),
                &mut state,
                cancelled,
            )
            .await?;
            state.files_done += 1;
            report(key, &state);
        }
    } else {
        state.bytes_total = root_meta.size.unwrap_or(0);
        state.files_total = 1;
        report(key, &state);
        if let Some(parent) = local_root.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|error| format!("创建本地目录失败: {error}"))?;
        }
        download_one_file(key, &session, &remote, &local_root, &mut state, cancelled).await?;
        state.files_done = 1;
    }
    Ok(state)
}

async fn download_one_file(
    key: &str,
    session: &russh_sftp::client::SftpSession,
    remote: &str,
    local: &std::path::Path,
    state: &mut SftpTransferState,
    cancelled: &Arc<AtomicBool>,
) -> Result<(), String> {
    let mut source = session
        .open(remote.to_string())
        .await
        .map_err(|error| format!("打开远端文件失败: {error}"))?;
    let mut target = tokio::fs::File::create(local)
        .await
        .map_err(|error| format!("创建本地文件失败: {error}"))?;
    let mut buffer = vec![0u8; TRANSFER_BUFFER_BYTES];
    loop {
        is_cancelled(cancelled)?;
        let read = source
            .read(&mut buffer)
            .await
            .map_err(|error| format!("读取远端文件失败: {error}"))?;
        if read == 0 {
            break;
        }
        target
            .write_all(&buffer[..read])
            .await
            .map_err(|error| format!("写入本地文件失败: {error}"))?;
        state.bytes_done = state.bytes_done.saturating_add(read as u64);
        report(key, state);
    }
    target
        .flush()
        .await
        .map_err(|error| format!("写入本地文件失败: {error}"))?;
    Ok(())
}
