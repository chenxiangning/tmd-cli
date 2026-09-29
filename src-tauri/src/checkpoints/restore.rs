//! 事务化还原 —— 全部基于账本:回退计划取自 turn 条目固化的前后像,
//! 回退前自动落 guard 条目(反悔恢复的依据),只动批次触碰的路径,
//! hunk,他人写入保留;A 文件以空基线摘除本批写入块),重叠冲突与不具备
//! 手术条件的路径(D 文件、像缺失)一律 skip,绝不静默覆盖(设计 §6)。
//!
//! 锁纪律:guard 抓取会枚举 dirty 集(读 repo),与账本写同持 LEDGER_LOCK,
//! 串行执行,不存在 derive 时代的闭包嵌套锁问题。

use super::surgical::surgical_erase;
use super::{
    append_ledger, load_ledger, load_states, new_entry_id, now_millis, open_sidecar, open_user,
    resolve_snap_bytes, save_states, CkptError, LedgerEntry,
};
use serde::Serialize;
use std::fs;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkipEntry {
    pub path: String,
    pub reason: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOutcome {
    pub restored: Vec<String>,
    pub deleted: Vec<String>,
    pub skipped: Vec<SkipEntry>,
    pub guard_id: Option<String>,
    /// 还原后的批次态(pending = 部分回退,批仍在待审)
    pub state: String,
}

/// 回退整批或子集(paths 缺省 = 全部可回退文件)。计划来自账本 turn 条目:
/// live 内容必须等于批后像才可回退;失配先试 diff 精准擦除(共改文件只擦
/// 本批 hunk);批前像取账本 before_oid(sidecar blob)。
pub fn restore_batch(
    cwd: &str,
    batch_id: &str,
    paths: Option<Vec<String>>,
) -> Result<RestoreOutcome, CkptError> {
    let _g = super::lock_ledger();
    let entries = load_ledger(cwd);
    let anchor = entries
        .iter()
        .find(|e| e.kind == "anchor" && e.id == batch_id)
        .ok_or_else(|| CkptError::Empty(format!("批次不存在: {batch_id}")))?
        .clone();
    let turn = entries
        .iter()
        .rfind(|e| e.kind == "turn" && e.id == batch_id)
        .ok_or_else(|| CkptError::Empty("进行中批次不可回退 —— 等本轮结算封口后再操作".into()))?
        .clone();

    let mut states = load_states(cwd);
    if states
        .batches
        .get(batch_id)
        .map(|s| s.state == "reverted")
        .unwrap_or(false)
    {
        return Err(CkptError::Empty("批次已整体回退(可先反悔恢复)".into()));
    }

    let sidecar = open_sidecar(cwd)?;
    let user = open_user(cwd).ok();
    let root = std::path::PathBuf::from(cwd);

    // 阶段一:解析还原计划 + skip 判定(内容失配/已处理/已回退一律跳过)
    let stored = states.batches.get(batch_id);
    let mut plan: Vec<(String, PlanOp)> = Vec::new();
    let mut skipped = Vec::new();
    let targets: Vec<String> = match &paths {
        Some(ps) => {
            for p in ps {
                if !turn.turn_files.iter().any(|tf| &tf.path == p) {
                    return Err(CkptError::Empty(format!("路径不在批次内: {p}")));
                }
            }
            ps.clone()
        }
        None => turn.turn_files.iter().map(|tf| tf.path.clone()).collect(),
    };
    for path in &targets {
        let Some(tf) = turn.turn_files.iter().find(|tf| &tf.path == path) else {
            continue;
        };
        if stored
            .map(|s| s.reverted_paths.iter().any(|p| p == path))
            .unwrap_or(false)
        {
            skipped.push(SkipEntry {
                path: path.clone(),
                reason: "已回退".into(),
            });
            continue;
        }
        // 工作区外无前像(首轮事件写后观测,批前像不可知):显式禁回退 ——
        // 无前像无法区分「批内新建」与「覆盖既有文件」,回退可能误删用户文件。
        if tf.existed_before && tf.before_oid.is_empty() && super::is_external_path(path) {
            skipped.push(SkipEntry {
                path: path.clone(),
                reason: "工作区外批前像不可知,禁回退".into(),
            });
            continue;
        }
        // 内容失配/已提交判定:live 必须与批后像逐字节一致(或同样不存在)
        let after = if tf.after_oid.is_empty() {
            None
        } else {
            let oid = git2::Oid::from_str(&tf.after_oid)?;
            Some(sidecar.find_blob(oid)?.content().to_vec())
        };
        let live_bytes = fs::read(root.join(path)).ok();
        let untouched = match (&after, &live_bytes) {
            (None, None) => true,
            (Some(a), Some(l)) => a == l,
            _ => false,
        };
        if !untouched {
            match surgical_erase(&sidecar, tf, after.as_ref(), live_bytes.as_ref()) {
                Ok(Some(merged)) => {
                    plan.push((path.clone(), PlanOp::Write(merged)));
                    continue;
                }
                Ok(None) => {
                    skipped.push(SkipEntry {
                        path: path.clone(),
                        reason: "改动重叠".into(),
                    });
                    continue;
                }
                Err(()) => {
                    skipped.push(SkipEntry {
                        path: path.clone(),
                        reason: "内容已变".into(),
                    });
                    continue;
                }
            }
        }
        let op = if !tf.existed_before {
            PlanOp::Delete // 批前不存在 → 批内新建,回退 = 删除
        } else if !tf.before_oid.is_empty() {
            let oid = git2::Oid::from_str(&tf.before_oid)?;
            PlanOp::Write(sidecar.find_blob(oid)?.content().to_vec())
        } else {
            // 批前像缺失(skip 文件无内容):尝试 anchor 基线兜底(legacy 路径;
            // events 条目的 before_oid 已自足,不落到这里)
            match resolve_snap_bytes(&sidecar, user.as_ref(), &anchor.files, path)? {
                Some((bytes, _)) => PlanOp::Write(bytes),
                None => {
                    skipped.push(SkipEntry {
                        path: path.clone(),
                        reason: "前像缺失".into(),
                    });
                    continue;
                }
            }
        };
        plan.push((path.clone(), op));
    }

    if plan.is_empty() {
        return Err(CkptError::Empty(
            "没有可回退的文件(全部已处理或内容已变)".into(),
        ));
    }

    // 阶段二:守卫条目(账本)→ 执行磁盘写入。
    // 守卫只抓即将被触碰的路径(精准快照,非 git 工作区同样可用)
    let guard_paths: Vec<String> = plan.iter().map(|(p, _)| p.clone()).collect();
    let guard = LedgerEntry {
        id: new_entry_id(now_millis()),
        kind: "guard".into(),
        ts: now_millis(),
        session_id: anchor.session_id.clone(),
        tmd_session_id: anchor.tmd_session_id.clone(),
        turn: 0,
        prompt: format!("回退守卫 · 批次 {batch_id}"),
        batch_id: batch_id.to_string(),
        files: super::snapshot_paths(cwd, &guard_paths)?,
        attribution: anchor.attribution.clone(),
        ..Default::default()
    };
    append_ledger(cwd, &guard)?;

    let mut restored = Vec::new();
    let mut deleted = Vec::new();
    /* 单路径 IO 失败(Windows:目标被无 FILE_SHARE_DELETE 句柄占用 / 只读属性)
    只跳过该路径并显式列出,不中断整批 —— 此前 `?` 上抛发生在 guard 已落账、states
    未合成之前,磁盘半改而审批线零记账(2026-09-28 评审)。write_atomic 原子,
    失败路径留在盘上原样,批次保持 pending 可整批重试。 */
    let mut io_failed = false;
    for (path, op) in &plan {
        match op {
            PlanOp::Write(bytes) => {
                let full = root.join(path);
                let write = (|| -> std::io::Result<()> {
                    if let Some(parent) = full.parent() {
                        fs::create_dir_all(parent)?;
                    }
                    crate::session::write_atomic(&full, bytes)
                })();
                match write {
                    Ok(()) => restored.push(path.clone()),
                    Err(e) => {
                        io_failed = true;
                        skipped.push(SkipEntry {
                            path: path.clone(),
                            reason: format!("写入失败(可整批重试): {e}"),
                        });
                    }
                }
            }
            PlanOp::Delete => {
                let full = root.join(path);
                if full.symlink_metadata().is_ok() {
                    match fs::remove_file(&full) {
                        Ok(()) => deleted.push(path.clone()),
                        Err(e) => {
                            io_failed = true;
                            skipped.push(SkipEntry {
                                path: path.clone(),
                                reason: format!("删除失败(可整批重试): {e}"),
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
        }
    }

    // 阶段三:状态合成 —— 全部路径处理完(含失配)才翻 reverted,否则留在待审
    let mut entry = states.batches.get(batch_id).cloned().unwrap_or_default();
    entry.reverted_paths.extend(restored.iter().cloned());
    entry.reverted_paths.extend(deleted.iter().cloned());
    entry.guard_ids.push(guard.id.clone());
    entry.guard_id = Some(guard.id.clone());
    let processed = turn.turn_files.iter().all(|tf| {
        entry.reverted_paths.contains(&tf.path) || skipped.iter().any(|s| s.path == tf.path)
    });
    entry.state = if processed && !io_failed {
        "reverted".into()
    } else {
        "pending".into()
    };
    states.batches.insert(batch_id.to_string(), entry.clone());
    save_states(cwd, &states)?;

    Ok(RestoreOutcome {
        restored,
        deleted,
        skipped,
        guard_id: Some(guard.id),
        state: entry.state,
    })
}

// 应用(apply_batch)拆至 apply.rs —— restore 的镜像语义独立成文(文件规模铁则)。
pub(super) enum PlanOp {
    Write(Vec<u8>),
    Delete,
}
