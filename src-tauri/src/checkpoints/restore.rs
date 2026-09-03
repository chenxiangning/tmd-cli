//! 事务化还原 —— 回退前自动打守卫快照(guard),只动批次触碰的路径,
//! 内容失配(手改/后续批触碰)一律 skip,绝不静默覆盖(设计 §6)。
//!
//! 锁纪律:不在 with_repo 闭包内调 capture_snapshot(会再抢同一 repo 锁死锁)——
//! 先在闭包内解析还原计划,释放锁后再抓 guard、执行磁盘写入。

use super::capture::SnapKind;
use super::derive::{batch_paths, classify_live};
use super::{
    capture_snapshot, load_manifests, load_states, resolve_snap_bytes, save_states, open_sidecar,
    BatchState, CkptError,
};
use serde::Serialize;

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
    let manifests = load_manifests(cwd);
    let exists = manifests
        .iter()
        .any(|s| s.kind == "anchor" && s.id == batch_id);
    if !exists {
        return Err(CkptError::Empty(format!("批次不存在: {batch_id}")));
    }
    let mut states = load_states(cwd);
    let entry = states.batches.get(batch_id).cloned().unwrap_or_default();
    if entry.state == "reverted" {
        return Err(CkptError::Empty("批次已回退,无需通过标记".into()));
    }
    states.batches.insert(
        batch_id.to_string(),
        BatchState {
            state: "approved".into(),
            ..entry
        },
    );
    save_states(cwd, &states)?;
    Ok(())
}

/// 回退整批或子集(paths 缺省 = 全部可回退文件)。
pub fn restore_batch(
    cwd: &str,
    batch_id: &str,
    paths: Option<Vec<String>>,
) -> Result<RestoreOutcome, CkptError> {
    let manifests = load_manifests(cwd);
    let anchors: Vec<&super::Snapshot> = manifests.iter().filter(|s| s.kind == "anchor").collect();
    let ai = anchors
        .iter()
        .position(|s| s.id == batch_id)
        .ok_or_else(|| CkptError::Empty(format!("批次不存在: {batch_id}")))?;
    let a = anchors[ai];
    let b = anchors.get(ai + 1).copied().ok_or_else(|| {
        CkptError::Empty("进行中批次不可回退 —— 等下一条消息封口后再操作".into())
    })?;

    let mut states = load_states(cwd);
    if states.batches.get(batch_id).map(|s| s.state == "reverted").unwrap_or(false) {
        return Err(CkptError::Empty("批次已整体回退(可先反悔恢复)".into()));
    }

    let sidecar = open_sidecar(cwd)?;
    let root = std::path::PathBuf::from(cwd);

    // 阶段一:解析还原计划 + skip 判定
    let (plan, mut skipped, all_paths) = {
        let user = super::open_user(cwd)?;
        let live = super::capture::dirty_paths(&user)?;
        let Some(all) = batch_paths(&sidecar, &user, &root, a, Some(b), false, &live) else {
            return Err(CkptError::Empty("批次无文件差异".into()));
        };
        let targets: Vec<String> = match &paths {
            Some(ps) => {
                let known: std::collections::BTreeSet<_> = all.iter().map(|(p, _)| p).collect();
                for p in ps {
                    if !known.contains(p) {
                        return Err(CkptError::Empty(format!("路径不在批次内: {p}")));
                    }
                }
                ps.clone()
            }
            None => all.iter().map(|(p, _)| p.clone()).collect(),
        };
        let mut plan: Vec<(String, PlanOp)> = Vec::new();
        let mut skipped = Vec::new();
        for path in &targets {
            let live_state = classify_live(&sidecar, &user, &root, b, path, &live)?;
            match live_state.as_str() {
                "same" => {}
                "reverted" => skipped.push(SkipEntry { path: path.clone(), reason: "已回退".into() }),
                "changed" => skipped.push(SkipEntry { path: path.clone(), reason: "内容已变".into() }),
                // committed 文件内容 == 批后像,写回等于撤用户已提交的工作 —— skip,由 done 语义兜底
                _ => skipped.push(SkipEntry { path: path.clone(), reason: "已处理".into() }),
            }
            if live_state != "same" {
                continue;
            }
            let op = match resolve_snap_bytes(&sidecar, &user, a, path)? {
                Some((bytes, _)) => PlanOp::Write(bytes),
                None => PlanOp::Delete, // 批前不存在 → 批内新建,回退 = 删除
            };
            plan.push((path.clone(), op));
        }
        (plan, skipped, all)
    };

    if plan.is_empty() {
        return Err(CkptError::Empty("没有可回退的文件(全部已处理或内容已变)".into()));
    }

    // 阶段二(锁外):守卫快照 → 执行磁盘写入
    let guard = capture_snapshot(cwd, &a.session_id, &format!("回退守卫 · 批次 {batch_id}"), SnapKind::Guard)?;
    let mut restored = Vec::new();
    let mut deleted = Vec::new();
    for (path, op) in &plan {
        match op {
            PlanOp::Write(bytes) => {
                let full = root.join(path);
                if let Some(parent) = full.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::write(&full, bytes)?;
                restored.push(path.clone());
            }
            PlanOp::Delete => {
                let full = root.join(path);
                if full.symlink_metadata().is_ok() {
                    std::fs::remove_file(&full)?;
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
    let processed = all_paths.iter().all(|(p, _)| {
        entry.reverted_paths.contains(p)
            || skipped.iter().any(|s| &s.path == p)
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

/// 反悔:用守卫快照把整批写回回退前的状态(内容失配的路径同样 skip)。
pub fn undo_revert(cwd: &str, batch_id: &str) -> Result<RestoreOutcome, CkptError> {
    let states = load_states(cwd);
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

    let manifests = load_manifests(cwd);
    let guard = manifests
        .iter()
        .find(|s| s.id == guard_id)
        .ok_or_else(|| CkptError::Store(format!("守卫快照丢失: {guard_id}")))?;

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
        let entry = guard.files.iter().find(|f| &f.path == path);
        let bytes = match entry {
            Some(f) if f.skip.is_none() && !f.oid.is_empty() => {
                let oid = git2::Oid::from_str(&f.oid)?;
                Some(sidecar.find_blob(oid)?.content().to_vec())
            }
            _ => None,
        };
        match bytes {
            Some(data) => {
                if let Some(parent) = full.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::write(&full, data)?;
                restored.push(path.clone());
            }
            None => {
                if full.symlink_metadata().is_ok() {
                    std::fs::remove_file(&full)?;
                    deleted.push(path.clone());
                } else {
                    skipped.push(SkipEntry { path: path.clone(), reason: "已不存在".into() });
                }
            }
        }
    }

    let mut states = load_states(cwd);
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
