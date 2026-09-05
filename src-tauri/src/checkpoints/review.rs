//! 审核态操作 —— 自 restore.rs 拆出(文件规模铁则)。
//! approve(纯标记,不动文件/不碰 git)与 undo_revert(以 guard 条目写回回退前状态)。

use super::restore::{RestoreOutcome, SkipEntry};
use super::{load_ledger, load_states, open_sidecar, save_states, CkptError};
use std::fs;
/// 通过标记 —— 纯标记动作,不动任何文件、不触碰 git。 approved 批仍可回退
/// (标记弱于安全动作);其后若文件被提交/失配,展示层自动升级为 done。
pub fn approve_batch(cwd: &str, batch_id: &str) -> Result<(), CkptError> {
    let _g = super::lock_ledger();
    let entries = load_ledger(cwd);
    if !entries
        .iter()
        .any(|e| e.kind == "anchor" && e.id == batch_id)
    {
        return Err(CkptError::Empty(format!("批次不存在: {batch_id}")));
    }
    let mut states = load_states(cwd);
    let entry = states.batches.get(batch_id).cloned().unwrap_or_default();
    if entry.state == "reverted" {
        return Err(CkptError::Empty("批次已回退,无需通过标记".into()));
    }
    states.batches.insert(
        batch_id.to_string(),
        super::BatchState {
            state: "approved".into(),
            ..entry
        },
    );
    save_states(cwd, &states)?;
    Ok(())
}

/// 反悔:用账本 guard 条目把整批写回回退前的状态(内容失配的路径同样 skip)。
pub fn undo_revert(cwd: &str, batch_id: &str) -> Result<RestoreOutcome, CkptError> {
    let _g = super::lock_ledger();
    let mut states = load_states(cwd);
    let entry = states
        .batches
        .get(batch_id)
        .cloned()
        .ok_or_else(|| CkptError::Empty("批次无审核态".into()))?;
    let guard_id = entry
        .guard_id
        .clone()
        .ok_or_else(|| CkptError::Empty("该批没有守卫快照,无法反悔".into()))?;
    if entry.state != "reverted" {
        return Err(CkptError::Empty("批次不在已退状态".into()));
    }
    let guard = load_ledger(cwd)
        .into_iter()
        .find(|e| e.kind == "guard" && e.id == guard_id)
        .ok_or_else(|| CkptError::Store(format!("守卫条目丢失: {guard_id}")))?;

    let sidecar = open_sidecar(cwd)?;
    let root = std::path::PathBuf::from(cwd);

    // 守卫内容就是"回退前一刻"的工作区;只还原回退动作实际碰过的路径
    // (reverted_paths),守卫里其他 dirty 文件保持原样
    let reverted_paths = entry.reverted_paths.clone();
    let mut restored = Vec::new();
    let mut deleted = Vec::new();
    let mut skipped = Vec::new();
    for path in &reverted_paths {
        let full = root.join(path);
        let bytes = match guard.files.iter().find(|f| f.path == *path) {
            Some(f) if f.skip.is_none() && !f.oid.is_empty() => {
                let oid = git2::Oid::from_str(&f.oid)?;
                Some(sidecar.find_blob(oid)?.content().to_vec())
            }
            _ => None,
        };
        match bytes {
            Some(data) => {
                if let Some(parent) = full.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(&full, data)?;
                restored.push(path.clone());
            }
            None => {
                if full.symlink_metadata().is_ok() {
                    fs::remove_file(&full)?;
                    deleted.push(path.clone());
                } else {
                    skipped.push(SkipEntry {
                        path: path.clone(),
                        reason: "已不存在".into(),
                    });
                }
            }
        }
    }

    let mut entry = states.batches.get(batch_id).cloned().unwrap_or_default();
    entry.state = "pending".into();
    entry.reason = None;
    entry.reverted_paths.clear();
    entry.guard_id = None;
    states.batches.insert(batch_id.to_string(), entry);
    save_states(cwd, &states)?;

    Ok(RestoreOutcome {
        restored,
        deleted,
        skipped,
        guard_id: None,
        state: "pending".into(),
    })
}
