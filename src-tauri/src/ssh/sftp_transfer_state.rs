//! SFTP 传输状态注册表 —— 传输状态(queued/running/done/failed/cancelled)的
//! 进程级表、取消、进度上报,供命令层与传输任务共用。

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use parking_lot::Mutex;
use serde::Serialize;

/// 一次传输的全量状态(事件载荷与查询共用)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpTransferState {
    pub id: String,
    pub session_id: String,
    /// upload | download。
    pub direction: String,
    /// queued | running | done | failed | cancelled。
    pub status: String,
    pub source_path: String,
    pub target_path: String,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub files_done: u32,
    pub files_total: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

struct TransferSlot {
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    last: SftpTransferState,
}

/// 进程级传输表:key = "{session_id}:{transfer_id}"。
static TRANSFERS: std::sync::LazyLock<Mutex<HashMap<String, TransferSlot>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// 会话终局级联:标记在途传输取消并清表。
pub fn cancel_session_transfers(session_id: &str) {
    let prefix = format!("{session_id}:");
    let mut transfers = TRANSFERS.lock();
    let keys: Vec<String> = transfers
        .keys()
        .filter(|key| key.starts_with(&prefix))
        .map(Clone::clone)
        .collect();
    for key in keys {
        if let Some(slot) = transfers.remove(&key) {
            slot.cancelled.store(true, Ordering::SeqCst);
        }
    }
}

pub fn cancel_transfer(session_id: &str, transfer_id: &str) -> Result<(), String> {
    let key = format!("{}:{}", session_id.trim(), transfer_id.trim());
    let slot = TRANSFERS
        .lock()
        .get(&key)
        .map(|slot| Arc::clone(&slot.cancelled))
        .ok_or_else(|| "SFTP 传输不存在或已结束".to_string())?;
    slot.store(true, Ordering::SeqCst);
    Ok(())
}

pub fn transfer_status(session_id: &str, transfer_id: &str) -> Result<SftpTransferState, String> {
    let key = format!("{}:{}", session_id.trim(), transfer_id.trim());
    TRANSFERS
        .lock()
        .get(&key)
        .map(|slot| slot.last.clone())
        .ok_or_else(|| "SFTP 传输不存在或已结束".to_string())
}

/// 登记新传输(queued),返回取消句柄供任务持有。
pub(crate) fn register(state: SftpTransferState) -> (String, Arc<std::sync::atomic::AtomicBool>) {
    let key = format!("{}:{}", state.session_id.trim(), state.id);
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    TRANSFERS.lock().insert(
        key.clone(),
        TransferSlot {
            cancelled: Arc::clone(&cancelled),
            last: state,
        },
    );
    (key, cancelled)
}

/// 传输中更新进度并广播。
pub(crate) fn report(key: &str, state: &SftpTransferState) {
    if let Some(slot) = TRANSFERS.lock().get_mut(key) {
        slot.last = state.clone();
    }
    super::sftp::broadcast_transfer("progress", state);
}

/// 终局落账(记录最终状态;调用方随后广播事件)。
pub(crate) fn finish(key: &str, state: SftpTransferState) {
    if let Some(slot) = TRANSFERS.lock().get_mut(key) {
        slot.last = state;
    }
}

/// 兜底快照:任务失败时表里可能已无条目(级联清表),用模板重建失败态。
pub(crate) fn last_or(key: &str, template: SftpTransferState) -> SftpTransferState {
    TRANSFERS
        .lock()
        .get(key)
        .map(|slot| slot.last.clone())
        .unwrap_or(template)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(direction: &str) -> SftpTransferState {
        SftpTransferState {
            id: "t1".into(),
            session_id: "s1".into(),
            direction: direction.into(),
            status: "queued".into(),
            source_path: "/a".into(),
            target_path: "/b".into(),
            bytes_done: 0,
            bytes_total: 0,
            files_done: 0,
            files_total: 0,
            error: None,
        }
    }

    #[test]
    fn register_report_finish_lifecycle() {
        let (key, cancelled) = register(sample("upload"));
        assert!(transfer_status("s1", "t1").is_ok());
        let mut state = sample("upload");
        state.status = "running".into();
        state.bytes_done = 42;
        report(&key, &state);
        assert_eq!(transfer_status("s1", "t1").unwrap().bytes_done, 42);
        state.status = "done".into();
        finish(&key, state);
        assert_eq!(transfer_status("s1", "t1").unwrap().status, "done");
        cancelled.store(true, Ordering::SeqCst);
        cancel_session_transfers("s1");
        assert!(transfer_status("s1", "t1").is_err());
    }

    #[test]
    fn last_or_falls_back_to_template() {
        let template = sample("download");
        let got = last_or("missing:key", template.clone());
        assert_eq!(got.id, template.id);
    }
}
