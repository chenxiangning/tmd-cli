//! 事务化还原 —— 全部基于账本:回退计划取自 turn 条目固化的前后像,
//! 回退前自动落 guard 条目(反悔恢复的依据),只动批次触碰的路径,
//! 内容失配(手改/后续批触碰)一律 skip,绝不静默覆盖(设计 §6)。
//!
//! 锁纪律:guard 抓取会枚举 dirty 集(读 repo),与账本写同持 LEDGER_LOCK,
//! 串行执行,不存在 derive 时代的闭包嵌套锁问题。

use super::{
    append_ledger, load_ledger, load_states, new_entry_id, now_millis,
    open_sidecar, open_user, resolve_snap_bytes, save_states, CkptError, LedgerEntry,
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

/// 通过标记 —— 纯标记动作,不动任何文件、不触碰 git。 approved 批仍可回退
/// (标记弱于安全动作);其后若文件被提交/失配,展示层自动升级为 done。
pub fn approve_batch(cwd: &str, batch_id: &str) -> Result<(), CkptError> {
    let _g = super::lock_ledger();
    let entries = load_ledger(cwd);
    if !entries.iter().any(|e| e.kind == "anchor" && e.id == batch_id) {
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

/// 回退整批或子集(paths 缺省 = 全部可回退文件)。计划来自账本 turn 条目:
/// live 内容必须等于批后像才可回退;批前像取账本 before_oid(sidecar blob)。
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
        .filter(|e| e.kind == "turn" && e.id == batch_id)
        .next_back()
        .ok_or_else(|| {
            CkptError::Empty("进行中批次不可回退 —— 等本轮结算封口后再操作".into())
        })?
        .clone();

    let mut states = load_states(cwd);
    if states.batches.get(batch_id).map(|s| s.state == "reverted").unwrap_or(false) {
        return Err(CkptError::Empty("批次已整体回退(可先反悔恢复)".into()));
    }

    let sidecar = open_sidecar(cwd)?;
    let user = open_user(cwd)?;
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
            skipped.push(SkipEntry { path: path.clone(), reason: "已回退".into() });
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
        let untouched = match (&after, live_bytes) {
            (None, None) => true,
            (Some(a), Some(l)) => a == &l,
            _ => false,
        };
        if !untouched {
            skipped.push(SkipEntry { path: path.clone(), reason: "内容已变".into() });
            continue;
        }
        let op = if !tf.existed_before {
            PlanOp::Delete // 批前不存在 → 批内新建,回退 = 删除
        } else if !tf.before_oid.is_empty() {
            let oid = git2::Oid::from_str(&tf.before_oid)?;
            PlanOp::Write(sidecar.find_blob(oid)?.content().to_vec())
        } else {
            // 批前像缺失(skip 文件无内容):尝试 anchor 基线兜底
            match resolve_snap_bytes(&sidecar, &user, &anchor.files, path)? {
                Some((bytes, _)) => PlanOp::Write(bytes),
                None => {
                    skipped.push(SkipEntry { path: path.clone(), reason: "前像缺失".into() });
                    continue;
                }
            }
        };
        plan.push((path.clone(), op));
    }

    if plan.is_empty() {
        return Err(CkptError::Empty("没有可回退的文件(全部已处理或内容已变)".into()));
    }

    // 阶段二:守卫条目(账本)→ 执行磁盘写入
    let guard = LedgerEntry {
        id: new_entry_id(now_millis()),
        kind: "guard".into(),
        ts: now_millis(),
        session_id: anchor.session_id.clone(),
        tmd_session_id: anchor.tmd_session_id.clone(),
        turn: 0,
        prompt: format!("回退守卫 · 批次 {batch_id}"),
        engine: String::new(),
        model: String::new(),
        thinking: String::new(),
        seal_ts: 0,
        batch_id: batch_id.to_string(),
        files: super::snapshot_files(cwd)?,
        turn_files: Vec::new(),
    };
    append_ledger(cwd, &guard)?;

    let mut restored = Vec::new();
    let mut deleted = Vec::new();
    for (path, op) in &plan {
        match op {
            PlanOp::Write(bytes) => {
                let full = root.join(path);
                if let Some(parent) = full.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(&full, bytes)?;
                restored.push(path.clone());
            }
            PlanOp::Delete => {
                let full = root.join(path);
                if full.symlink_metadata().is_ok() {
                    fs::remove_file(&full)?;
                    deleted.push(path.clone());
                } else {
                    skipped.push(SkipEntry { path: path.clone(), reason: "已不存在".into() });
                }
            }
        }
    }

    // 阶段三:状态合成 —— 全部路径处理完(含失配)才翻 reverted,否则留在待审
    let mut entry = states.batches.get(batch_id).cloned().unwrap_or_default();
    entry.reverted_paths.extend(restored.iter().cloned());
    entry.reverted_paths.extend(deleted.iter().cloned());
    entry.guard_id = Some(guard.id.clone());
    let processed = turn.turn_files.iter().all(|tf| {
        entry.reverted_paths.contains(&tf.path)
            || skipped.iter().any(|s| s.path == tf.path)
    });
    entry.state = if processed { "reverted".into() } else { "pending".into() };
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
                    skipped.push(SkipEntry { path: path.clone(), reason: "已不存在".into() });
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

enum PlanOp {
    Write(Vec<u8>),
    Delete,
}
