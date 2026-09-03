//! 应用 —— 回退的镜像(restore.rs 的姊妹模块,文件规模铁则拆分)。
//!
//! 把账本固化的批后像精确写回磁盘,副本作为依据。安全纪律与回退对称:
//! live == 批前像(或该文件已被回退删除)才写;live == 批后像 skip「已是」;
//! 其余失配一律跳过并显式列出,绝不静默覆盖。执行前打 guard(可反悔,与 undo 配对)。
//! 仅已退批可应用(后端状态闸,防 pending/done 批经直调 IPC 被写回)。
//!
//! 锁纪律与 restore 相同:全程持 LEDGER_LOCK 串行。

use super::restore::{PlanOp, RestoreOutcome, SkipEntry};
use super::{
    append_ledger, load_ledger, load_states, new_entry_id, now_millis, open_sidecar, open_user,
    resolve_snap_bytes, save_states, CkptError, LedgerEntry,
};
use std::fs;

/// 应用(设计点:回退**和**应用,副本作为依据):把账本固化的批后像
/// 精确写回磁盘 —— restore 的镜像。执行前打 guard(可反悔,与 undo 配对)。
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
