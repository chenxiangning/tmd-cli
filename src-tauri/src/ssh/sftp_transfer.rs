//! SFTP 传输 —— 上传/下载(递归、64KB 缓冲、进度事件、可取消)。
//! plan-walk + 流式拷贝;状态表见 sftp_transfer_state.rs;
//! 上传 → sftp_upload.rs,下载 → sftp_download.rs(文件规模铁则拆分)。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::sftp::{broadcast_transfer, global_sftp};
use super::sftp_download::run_download;
pub use super::sftp_transfer_state::{cancel_transfer, SftpTransferState};
use super::sftp_transfer_state::{finish, last_or, register};
use super::sftp_upload::run_upload;

pub(crate) fn is_cancelled(cancelled: &Arc<AtomicBool>) -> Result<(), String> {
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

pub(crate) async fn sftp_session(
    session_id: &str,
) -> Result<Arc<tokio::sync::Mutex<russh_sftp::client::SftpSession>>, String> {
    let registry = super::global_ssh().ok_or_else(|| "SSH 引擎未就绪".to_string())?;
    global_sftp().session_for(&registry, session_id).await
}

pub(crate) fn running_state(state: &mut SftpTransferState) {
    state.status = "running".to_string();
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
