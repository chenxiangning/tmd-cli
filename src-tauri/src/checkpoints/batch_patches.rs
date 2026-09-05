//! 批次逐文件 patch 导出 —— 自 view.rs 拆出(文件规模铁则)。
//! sealed 批直读账本固化 diff(零重算);open 批新像 = live 工作区,按需现算。

use super::attribution::turn_changed_paths;
use super::{entry_in_session, load_ledger, open_sidecar, open_user, CkptError};
use std::fs;
/// 批次逐文件 patch:sealed 批直接读账本固化的 diff(封口瞬间定死,零重算);
/// open 批新像 = live 工作区,按需现算(时间线 ± 与审阅单共用)。
pub fn batch_patches(cwd: &str, batch_id: &str) -> Result<Vec<super::CkptPatch>, CkptError> {
    let _g = super::lock_ledger();
    let entries = load_ledger(cwd);
    if let Some(t) = entries
        .iter()
        .rfind(|e| e.kind == "turn" && e.id == batch_id)
    {
        return Ok(t
            .turn_files
            .iter()
            .map(|tf| super::CkptPatch {
                path: tf.path.clone(),
                kind: tf.status.clone(),
                additions: tf.additions,
                deletions: tf.deletions,
                patch: tf.patch.clone(),
                binary: tf.binary,
            })
            .collect());
    }
    let a = entries
        .iter()
        .find(|e| e.kind == "anchor" && e.id == batch_id)
        .ok_or_else(|| CkptError::Empty(format!("批次不存在: {batch_id}")))?;
    // 历史锚点无 turn 条目 = 纯阅读轮,无 diff(open 窗口只属于最新锚点)
    let has_later = entries.iter().any(|e| {
        e.kind == "anchor"
            && e.id != a.id
            && entry_in_session(e, &a.session_id, &a.tmd_session_id)
            && (e.turn, e.ts) > (a.turn, a.ts)
    });
    if has_later {
        return Ok(Vec::new());
    }
    let sidecar = open_sidecar(cwd)?;
    let user = open_user(cwd).ok();
    let root = std::path::PathBuf::from(cwd);
    if a.attribution == "events" {
        // events open 批:纯事件归因,edit 行自足前像 → live 现算
        let mut out = Vec::new();
        for e in entries
            .iter()
            .filter(|e| e.kind == "edit" && e.id == batch_id)
        {
            let before: Option<Vec<u8>> = if e.before_oid.is_empty() {
                None
            } else {
                let oid = git2::Oid::from_str(&e.before_oid)?;
                Some(sidecar.find_blob(oid)?.content().to_vec())
            };
            let after = fs::read(root.join(&e.path)).ok();
            if before.as_deref() == after.as_deref() {
                continue; // 写了又写回:无 diff
            }
            out.push(super::blob_patch(
                &sidecar,
                &e.path,
                before.as_deref(),
                after.as_deref(),
            )?);
        }
        return Ok(out);
    }
    let Some(u) = user.as_ref() else {
        return Ok(Vec::new()); // git 归因 + 非 git:无推断素材
    };
    let live = super::dirty_paths(u)?;
    let changed = turn_changed_paths(&sidecar, Some(u), &root, a, &live, &entries)?;
    let paths: Vec<String> = changed.into_iter().map(|(p, _)| p).collect();
    super::open_batch_patches(cwd, &a.files, &paths)
}
