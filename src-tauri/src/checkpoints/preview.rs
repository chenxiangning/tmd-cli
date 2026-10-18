//! 恢复 dry-run 预览 —— plan_restore 只读链:计划 + 每写入项 live↔target
//! 行摘要(复用 diff.rs blob_patch 原语,live 每路径只读一次磁盘)。
//! 只出摘要清单,不渲染全 patch;不落守卫、不动工作区与账本(信息增强,
//! 永不是恢复的门槛)。注意 blob_patch 读取 target 侧时可能向 sidecar ODB
//! 物化 loose object(内容寻址去重,可被 prune 回收),非严格纯读。
//! undo_revert 前端复用 revert 时缓存的这份预览,不新发
//! dry-run(feasibility §6 undo 对称裁决)。

use super::diff::blob_patch;
use super::restore::{PlanOp, SkipEntry};
use super::{lock_ledger, open_sidecar, plan_restore, CkptError};
use serde::Serialize;
use std::fs;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRow {
    pub path: String,
    /// A 恢复新增(盘上已无/批前空侧) | M 修改 | D 恢复将删除
    pub kind: String,
    pub additions: u32,
    pub deletions: u32,
    /// 精准擦除成功行:执行将改写本地现状(「覆盖本地」药丸)
    pub overwrites: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RestorePreview {
    pub rows: Vec<PreviewRow>,
    pub skipped: Vec<SkipEntry>,
}

/// dry-run:阶段一计划 + 逐路径 live↔target 行摘要。kind 推导:Delete→D;
/// 批前空侧(live 缺失)→A;其余 M(blob_patch 同源判定);binary → 0/0 行。
/// 计划为空走 plan_restore 的同一 E_Empty(前端免弹分支信号)。
pub fn restore_preview(
    cwd: &str,
    batch_id: &str,
    paths: Option<Vec<String>>,
) -> Result<RestorePreview, CkptError> {
    let _g = lock_ledger();
    let plan = plan_restore(cwd, batch_id, paths)?;
    let sidecar = open_sidecar(cwd)?;
    let root = std::path::PathBuf::from(cwd);
    let mut rows = Vec::with_capacity(plan.items.len());
    for item in &plan.items {
        let live = fs::read(root.join(&item.path)).ok();
        let (old, new) = match &item.op {
            PlanOp::Write(target) => (live.as_deref(), Some(target.as_slice())),
            PlanOp::Delete => (live.as_deref(), None),
        };
        let patch = blob_patch(&sidecar, &item.path, old, new)?;
        let kind = if matches!(item.op, PlanOp::Delete) {
            "D"
        } else {
            patch.kind.as_str()
        };
        rows.push(PreviewRow {
            path: item.path.clone(),
            kind: kind.to_string(),
            additions: patch.additions,
            deletions: patch.deletions,
            overwrites: item.overwrite,
        });
    }
    Ok(RestorePreview {
        rows,
        skipped: plan.skipped,
    })
}
