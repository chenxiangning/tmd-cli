//! SFTP 传输 —— 上传/下载(递归、64KB 缓冲、进度事件、可取消)。
//! plan-walk + 流式拷贝;状态表见 sftp_transfer_state.rs。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::sftp::{broadcast_transfer, ensure_remote_dir, global_sftp, TRANSFER_BUFFER_BYTES};
use super::sftp_path::{join_remote_path, normalize_remote_path};
pub use super::sftp_transfer_state::{cancel_transfer, transfer_status, SftpTransferState};
use super::sftp_transfer_state::{finish, last_or, register, report};

fn is_cancelled(cancelled: &Arc<AtomicBool>) -> Result<(), String> {
    if cancelled.load(Ordering::SeqCst) {
        Err("SFTP 传输已取消".to_string())
    } else {
        Ok(())
    }
}

/// 启动传输(后台任务执行);返回 queued 初始状态。
pub fn start_transfer(
    session_id: String,
    direction: String,
    source_path: String,
    target_path: String,
    recursive: bool,
) -> Result<SftpTransferState, String> {
    let direction = match direction.as_str() {
        "upload" | "download" => direction.to_string(),
        other => return Err(format!("未知传输方向: {other}")),
    };
    let mut state = SftpTransferState {
        id: crate::pty::uuid_v4(),
        session_id: session_id.clone(),
        direction: direction.clone(),
        status: "queued".to_string(),
        source_path: source_path.clone(),
        target_path: target_path.clone(),
        bytes_done: 0,
        bytes_total: 0,
        files_done: 0,
        files_total: 0,
        error: None,
    };
    let (key, cancelled) = register(state.clone());
    broadcast_transfer("queued", &state);

    let session_id_task = session_id.clone();
    let transfer_id = state.id.clone();
    tauri::async_runtime::spawn(async move {
        let result = if direction == "upload" {
            run_upload(
                &session_id_task,
                &key,
                &source_path,
                &target_path,
                recursive,
                &cancelled,
            )
            .await
        } else {
            run_download(
                &session_id_task,
                &key,
                &source_path,
                &target_path,
                recursive,
                &cancelled,
            )
            .await
        };
        let final_state = match result {
            Ok(mut done_state) => {
                done_state.status = "done".to_string();
                done_state
            }
            Err(error) => {
                let cancelled_now = cancelled.load(Ordering::SeqCst);
                let mut failed = last_or(
                    &key,
                    SftpTransferState {
                        id: transfer_id,
                        session_id: session_id_task,
                        direction,
                        status: "failed".to_string(),
                        source_path,
                        target_path,
                        bytes_done: 0,
                        bytes_total: 0,
                        files_done: 0,
                        files_total: 0,
                        error: None,
                    },
                );
                failed.status = if cancelled_now { "cancelled" } else { "failed" }.to_string();
                failed.error = Some(error);
                failed
            }
        };
        finish(&key, final_state.clone());
        broadcast_transfer(&final_state.status, &final_state);
    });
    state.status = "running".to_string();
    Ok(state)
}

async fn sftp_session(
    session_id: &str,
) -> Result<Arc<tokio::sync::Mutex<russh_sftp::client::SftpSession>>, String> {
    let registry = super::global_ssh().ok_or_else(|| "SSH 引擎未就绪".to_string())?;
    global_sftp().session_for(&registry, session_id).await
}

fn running_state(state: &mut SftpTransferState) {
    state.status = "running".to_string();
}

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

async fn run_upload(
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

async fn run_download(
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direction_validation() {
        assert!(
            start_transfer("s".into(), "sideways".into(), "a".into(), "b".into(), false).is_err()
        );
    }
}
