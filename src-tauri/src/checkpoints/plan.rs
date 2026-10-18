//! 回退计划解析(阶段一,无副作用不碰盘)—— 自 restore.rs 拆出(文件规模铁则)。
//! restore_batch 与 checkpoint_restore_preview(dry-run 预览)共用同一份计划,
//! 否复制版 —— skip 语义两处必漂移(feasibility 042 项6)。
//!
//! 锁纪律:读账本/sidecar 与写链同持 LEDGER_LOCK 串行:restore_batch 执行链
//! 已持锁直接调用;preview 只读链自行取锁。本函数本身不加锁。

use super::restore::{PlanOp, SkipEntry};
use super::surgical::surgical_erase;
use super::{
    is_external_path, load_ledger, load_states, open_sidecar, open_user, resolve_snap_bytes,
    CkptError, LedgerEntry,
};
use std::fs;

/// 阶段一计划项:op = 落盘动作;overwrite = 精准擦除成功行(live 已偏离
/// 批后像,执行将改写本地现状 —— 预览据此打「覆盖本地」药丸)。
#[derive(Debug)]
pub(super) struct PlanItem {
    pub path: String,
    pub op: PlanOp,
    pub overwrite: bool,
}

/// 阶段一产出:还原计划 + skip 清单 + 守卫条目要回填的锚点身份。
#[derive(Debug)]
pub struct RestorePlan {
    pub(super) items: Vec<PlanItem>,
    pub skipped: Vec<SkipEntry>,
    /// 批次全部固化路径(阶段三「全部处理完」判定用)
    pub(super) turn_files: Vec<String>,
    pub(super) anchor: LedgerEntry,
}

/// 阶段一:解析还原计划 + skip 判定(内容失配/已处理/已回退一律跳过)。
/// 计划来自账本 turn 条目:live 内容必须等于批后像才可回退;失配先试 diff
/// 精准擦除(共改文件只擦本批 hunk);批前像取账本 before_oid(sidecar blob)。
/// plan 为空 → E_Empty(免弹分支的前端信号)。
pub fn plan_restore(
    cwd: &str,
    batch_id: &str,
    paths: Option<Vec<String>>,
) -> Result<RestorePlan, CkptError> {
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

    let states = load_states(cwd);
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

    let stored = states.batches.get(batch_id);
    let mut plan: Vec<PlanItem> = Vec::new();
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
        if tf.existed_before && tf.before_oid.is_empty() && is_external_path(path) {
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
                    plan.push(PlanItem {
                        path: path.clone(),
                        op: PlanOp::Write(merged),
                        overwrite: true,
                    });
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
        plan.push(PlanItem {
            path: path.clone(),
            op,
            overwrite: false,
        });
    }

    if plan.is_empty() {
        return Err(CkptError::EmptyPlan(
            "没有可回退的文件(全部已处理或内容已变)".into(),
        ));
    }

    Ok(RestorePlan {
        items: plan,
        skipped,
        turn_files: turn.turn_files.iter().map(|tf| tf.path.clone()).collect(),
        anchor,
    })
}
