//! 事务化还原 —— 全部基于账本:回退计划取自 turn 条目固化的前后像,
//! 回退前自动落 guard 条目(反悔恢复的依据),只动批次触碰的路径,
//! 内容失配(手改/后续批触碰)一律 skip,绝不静默覆盖(设计 §6)。
//!
//! 锁纪律:guard 抓取会枚举 dirty 集(读 repo),与账本写同持 LEDGER_LOCK,
//! 串行执行,不存在 derive 时代的闭包嵌套锁问题。

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
            skipped.push(SkipEntry {
                path: path.clone(),
                reason: "内容已变".into(),
            });
            continue;
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
    entry.guard_id = Some(guard.id.clone());
    let processed = turn.turn_files.iter().all(|tf| {
        entry.reverted_paths.contains(&tf.path) || skipped.iter().any(|s| s.path == tf.path)
    });
    entry.state = if processed {
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

/// 应用(设计点:回退**和**应用,副本作为依据):把账本固化的批后像
/// 精确写回磁盘 —— restore 的镜像。安全纪律与回退对称:live == 批前像
/// (或该文件已被回退删除)才写;live == 批后像 skip「已是」;其余失配
/// 一律跳过并显式列出,绝不静默覆盖。执行前打 guard(可反悔,与 undo 配对)。
pub fn apply_batch(
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
        .ok_or_else(|| CkptError::Empty("进行中批次不可应用 —— 等本轮结算封口后再操作".into()))?
        .clone();

    let sidecar = open_sidecar(cwd)?;
    let user = open_user(cwd).ok();
    let root = std::path::PathBuf::from(cwd);
    let mut states = load_states(cwd);
    // 应用是回退的镜像:仅已退批可应用(与 UI 露出条件一致;后端收紧,
    // 防 pending/done 批经直调 IPC 被写回 —— 内容比对之外再加状态闸)
    if !states
        .batches
        .get(batch_id)
        .map(|s| s.state == "reverted")
        .unwrap_or(false)
    {
        return Err(CkptError::Empty(
            "批次不在已退状态 —— 应用是回退的镜像,先回退再应用".into(),
        ));
    }

    // 阶段一:计划解析 —— 逐文件批后像写回,失配跳过
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
    let mut plan: Vec<(String, PlanOp)> = Vec::new();
    let mut skipped = Vec::new();
    for path in &targets {
        let Some(tf) = turn.turn_files.iter().find(|tf| &tf.path == path) else {
            continue;
        };
        // 回退态正是应用的主场景(live == 批前像);失配由内容比对兜底
        if tf.after_oid.is_empty() {
            // 批后像缺失(skip 文件)或批内删除:删除无「应用」语义(内容不可知)
            skipped.push(SkipEntry {
                path: path.clone(),
                reason: tf.skip.clone().unwrap_or_else(|| "批后无内容".into()),
            });
            continue;
        }
        let after = sidecar
            .find_blob(git2::Oid::from_str(&tf.after_oid)?)?
            .content()
            .to_vec();
        let live_bytes = fs::read(root.join(path)).ok();
        match live_bytes {
            Some(l) if l == after => {
                skipped.push(SkipEntry {
                    path: path.clone(),
                    reason: "已是该内容".into(),
                });
                continue;
            }
            Some(l) => {
                // live == 批前像(正处回退态)才写;其余 = 手改过,不静默覆盖
                let before: Option<Vec<u8>> = if tf.before_oid.is_empty() {
                    None
                } else {
                    Some(
                        sidecar
                            .find_blob(git2::Oid::from_str(&tf.before_oid)?)?
                            .content()
                            .to_vec(),
                    )
                };
                match (&before, user.as_ref()) {
                    (Some(b), _) if *b == l => plan.push((path.clone(), PlanOp::Write(after))),
                    (None, Some(u)) => {
                        // legacy 前像兜底(anchor 基线)
                        match resolve_snap_bytes(&sidecar, Some(u), &anchor.files, path)? {
                            Some((b, _)) if b == l => {
                                plan.push((path.clone(), PlanOp::Write(after)))
                            }
                            _ => skipped.push(SkipEntry {
                                path: path.clone(),
                                reason: "内容已变".into(),
                            }),
                        }
                    }
                    _ => skipped.push(SkipEntry {
                        path: path.clone(),
                        reason: "内容已变".into(),
                    }),
                }
            }
            None => plan.push((path.clone(), PlanOp::Write(after))), // 磁盘已无 → 写回批后像
        }
    }
    if plan.is_empty() {
        if skipped.is_empty() {
            return Err(CkptError::Empty("没有可应用的文件".into()));
        }
        // 全部失配:不写盘、不打守卫,返回结果让 UI 显式列出(绝不静默覆盖)
        let cur = states.batches.get(batch_id).cloned().unwrap_or_default();
        return Ok(RestoreOutcome {
            restored: Vec::new(),
            deleted: Vec::new(),
            skipped,
            guard_id: None,
            state: if cur.state.is_empty() {
                "pending".into()
            } else {
                cur.state
            },
        });
    }

    // 阶段二:守卫(可反悔)→ 写盘
    let guard_paths: Vec<String> = plan.iter().map(|(p, _)| p.clone()).collect();
    let guard = LedgerEntry {
        id: new_entry_id(now_millis()),
        kind: "guard".into(),
        ts: now_millis(),
        session_id: anchor.session_id.clone(),
        tmd_session_id: anchor.tmd_session_id.clone(),
        turn: 0,
        prompt: format!("应用守卫 · 批次 {batch_id}"),
        batch_id: batch_id.to_string(),
        files: super::snapshot_paths(cwd, &guard_paths)?,
        attribution: anchor.attribution.clone(),
        ..Default::default()
    };
    append_ledger(cwd, &guard)?;

    let mut restored = Vec::new();
    for (path, op) in &plan {
        if let PlanOp::Write(bytes) = op {
            let full = root.join(path);
            if let Some(parent) = full.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&full, bytes)?;
            restored.push(path.clone());
        }
    }

    // 阶段三:状态 —— 应用成功写回的路径退出回退集;全部退出 = 批回待审
    let mut entry = states.batches.get(batch_id).cloned().unwrap_or_default();
    entry.reverted_paths.retain(|p| !restored.contains(p));
    if entry.reverted_paths.is_empty() {
        entry.state = "pending".into();
        entry.reason = None;
    }
    entry.guard_id = Some(guard.id.clone());
    states.batches.insert(batch_id.to_string(), entry.clone());
    save_states(cwd, &states)?;

    Ok(RestoreOutcome {
        restored,
        deleted: Vec::new(),
        skipped,
        guard_id: Some(guard.id),
        state: entry.state,
    })
}

enum PlanOp {
    Write(Vec<u8>),
    Delete,
}
