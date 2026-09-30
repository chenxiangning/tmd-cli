//! 审核态操作 —— 自 restore.rs 拆出(文件规模铁则)。
//! approve(纯标记,不动文件/不碰 git)与 undo_revert(以 guard 条目写回回退前状态)。

use super::restore::{RestoreOutcome, SkipEntry};
use super::{load_ledger, load_states, open_sidecar, save_states, CkptError, LedgerEntry};
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
    if entry.state != "reverted" {
        return Err(CkptError::Empty("批次不在已退状态".into()));
    }
    if entry.guard_id.is_none() && entry.guard_ids.is_empty() {
        return Err(CkptError::Empty("该批没有守卫快照,无法反悔".into()));
    }

    let sidecar = open_sidecar(cwd)?;
    let root = std::path::PathBuf::from(cwd);

    // 守卫链解析:单文件回退各自持精准快照(guard_ids 追加序),反悔按路径取
    // 「最近覆盖它的 guard」;旧账本仅单 guard_id 时退化为原单槽行为。
    // 曾按「最后一个 guard 不覆盖即删盘上文件」处理 —— 那是用户既有内容,
    // 误删即数据丢失(2026-09-28 评审 F-CKPT-001)。
    let mut guard_ids = entry.guard_ids.clone();
    if guard_ids.is_empty() {
        if let Some(g) = &entry.guard_id {
            guard_ids.push(g.clone());
        }
    }
    let ledger = load_ledger(cwd);
    let guards: Vec<&LedgerEntry> = guard_ids
        .iter()
        .filter_map(|id| ledger.iter().find(|e| e.kind == "guard" && e.id == *id))
        .collect();

    // 守卫内容就是"回退前一刻"的工作区;只还原回退动作实际碰过的路径
    // (reverted_paths),守卫里其他 dirty 文件保持原样
    let reverted_paths = entry.reverted_paths.clone();
    let mut restored = Vec::new();
    let mut deleted = Vec::new();
    let mut skipped = Vec::new();
    /* 单路径失败只跳过并显式列出,不中断整批:`?` 上抛发生在 guard 链已落账、
    states 未合成之前,前缀路径已写回而 reverted_paths 零记账(2026-09-28 评审,
    restore.rs 同款)。失败路径留在已退态(remaining),可再次反悔重试。 */
    let mut remaining: Vec<String> = Vec::new();
    for path in &reverted_paths {
        // 最近覆盖该路径的 guard(链尾向前);守卫链里谁都不覆盖 = guard 条目
        // 已被清理的孤儿路径,保留记账不动盘
        let covering = guards
            .iter()
            .rev()
            .find(|g| g.files.iter().any(|f| f.path == *path))
            .and_then(|g| g.files.iter().find(|f| f.path == *path));
        let Some(f) = covering else {
            remaining.push(path.clone());
            continue;
        };
        // 守卫快照内容不可知(超大/符号链接/冲突):无法写回,但文件此刻在盘上
        // 的正是回退恢复出的旧内容 —— 删除即二次丢数据,保留已退态(2026-09-28 评审)
        if f.skip.is_some() {
            remaining.push(path.clone());
            skipped.push(SkipEntry {
                path: path.clone(),
                reason: format!(
                    "守卫快照内容不可知({}),保留已退态",
                    f.skip.as_deref().unwrap_or("skip")
                ),
            });
            continue;
        }
        let full = root.join(path);
        let bytes = if f.oid.is_empty() {
            None
        } else {
            match git2::Oid::from_str(&f.oid).map(|oid| sidecar.find_blob(oid)) {
                Ok(Ok(blob)) => Some(blob.content().to_vec()),
                // 账本/sidecar 异常按单路径失败处理,不炸整批
                Err(e) | Ok(Err(e)) => {
                    remaining.push(path.clone());
                    skipped.push(SkipEntry {
                        path: path.clone(),
                        reason: format!("守卫快照读取失败(可重试): {e}"),
                    });
                    continue;
                }
            }
        };
        match bytes {
            Some(data) => {
                let write = (|| -> std::io::Result<()> {
                    if let Some(parent) = full.parent() {
                        fs::create_dir_all(parent)?;
                    }
                    crate::session::write_atomic(&full, &data)
                })();
                match write {
                    Ok(()) => restored.push(path.clone()),
                    Err(e) => {
                        remaining.push(path.clone());
                        skipped.push(SkipEntry {
                            path: path.clone(),
                            reason: format!("反悔写入失败(可重试): {e}"),
                        });
                    }
                }
            }
            None if !f.existed && f.skip.is_none() => {
                // 守卫明确记录「回退前不存在」(批内新建被回退删除):反悔 = 恢复不存在态
                if full.symlink_metadata().is_ok() {
                    match fs::remove_file(&full) {
                        Ok(()) => deleted.push(path.clone()),
                        Err(e) => {
                            remaining.push(path.clone());
                            skipped.push(SkipEntry {
                                path: path.clone(),
                                reason: format!("反悔删除失败(可重试): {e}"),
                            });
                        }
                    }
                } else {
                    skipped.push(SkipEntry {
                        path: path.clone(),
                        reason: "已不存在".into(),
                    });
                }
            }
            None => {
                // 守卫没能快照内容(符号链接/超限/读取失败,skip=Some):盘上
                // 文件是用户既有内容,删除 = 误删 —— 与孤儿路径同一保守语义,
                // 记账不动盘、维持已退态(2026-09-28 三轮评审 CKPT-R1)
                skipped.push(SkipEntry {
                    path: path.clone(),
                    reason: "守卫快照不可用(符号链接/超限/读取失败),无法反悔".into(),
                });
                remaining.push(path.clone());
            }
        }
    }

    let mut entry = states.batches.get(batch_id).cloned().unwrap_or_default();
    let outcome_state = if remaining.is_empty() {
        entry.state = "pending".into();
        entry.reason = None;
        entry.reverted_paths.clear();
        entry.guard_id = None;
        entry.guard_ids.clear();
        "pending".into()
    } else {
        // 部分反悔:孤儿/失败路径维持已退态,守卫链保留供下次反悔
        entry.state = "reverted".into();
        entry.reverted_paths = remaining;
        entry.state.clone()
    };
    states.batches.insert(batch_id.to_string(), entry);
    save_states(cwd, &states)?;

    Ok(RestoreOutcome {
        restored,
        deleted,
        skipped,
        guard_id: None,
        state: outcome_state,
    })
}
