//! 事务化还原 —— 全部基于账本:回退计划取自 turn 条目固化的前后像,
//! 回退前自动落 guard 条目(反悔恢复的依据),只动批次触碰的路径,
//! hunk,他人写入保留;A 文件以空基线摘除本批写入块),重叠冲突与不具备
//! 手术条件的路径(D 文件、像缺失)一律 skip,绝不静默覆盖(设计 §6)。
//!
//! 阶段一(计划解析)拆至 plan.rs —— restore_batch 与 dry-run 预览共用
//! 同一份计划,否复制版 skip 语义必漂移(042 项6)。
//!
//! 锁纪律:guard 抓取会枚举 dirty 集(读 repo),与账本写同持 LEDGER_LOCK,
//! 串行执行,不存在 derive 时代的闭包嵌套锁问题。

use super::plan::{plan_restore, RestorePlan};
use super::{
    append_ledger, load_states, new_entry_id, now_millis, save_states, CkptError, LedgerEntry,
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

/// 回退整批或子集(paths 缺省 = 全部可回退文件)。两阶段:plan_restore 解析
/// 计划(纯,plan.rs),守卫落账 + 磁盘写入(本函数)。
pub fn restore_batch(
    cwd: &str,
    batch_id: &str,
    paths: Option<Vec<String>>,
) -> Result<RestoreOutcome, CkptError> {
    let _g = super::lock_ledger();
    let RestorePlan {
        items: plan,
        mut skipped,
        turn_files,
        anchor,
    } = plan_restore(cwd, batch_id, paths)?;

    let mut states = load_states(cwd);
    let root = std::path::PathBuf::from(cwd);

    // 阶段二:守卫条目(账本)→ 执行磁盘写入。
    // 守卫只抓即将被触碰的路径(精准快照,非 git 工作区同样可用)
    let guard_paths: Vec<String> = plan.iter().map(|i| i.path.clone()).collect();
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
    for item in &plan {
        let path = &item.path;
        match &item.op {
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
    let processed = turn_files
        .iter()
        .all(|p| entry.reverted_paths.contains(p) || skipped.iter().any(|s| &s.path == p));
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
#[derive(Debug)]
pub(super) enum PlanOp {
    Write(Vec<u8>),
    Delete,
}
