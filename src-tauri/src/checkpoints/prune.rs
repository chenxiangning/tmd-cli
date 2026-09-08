//! 保留策略 —— 自 view.rs 拆出(文件规模铁则)。
//! 每 cwd 保最近 keep 个 turn 批 + TTL;anchor/guard/edit 行随批保留,随后对
//! sidecar 对象库做 reachability 清理(账本自足,对象库不单调增长)。

use super::{
    load_ledger, load_states, now_millis, open_sidecar, rewrite_ledger, save_states, CkptError,
    LedgerEntry,
};
use std::collections::BTreeMap;
use std::fs;
/// 保留策略:每 cwd 保最近 keep 个 turn 批 + TTL 内的批;对应 anchor/guard/
/// edit 行随批保留,各会话尚未封口的最新 anchor 一并保留。随后对 sidecar
/// 对象库做 reachability 清理 —— 保留条目引用的 blob 之外全部删除
/// (设计点:账本自足,对象库不再单调增长)。返回移除的条目数。
pub fn prune(cwd: &str, keep: usize, ttl_days: u32) -> Result<usize, CkptError> {
    let _g = super::lock_ledger();
    let entries = load_ledger(cwd);
    let ttl_ms = ttl_days as i64 * 86_400_000;
    let cutoff = now_millis() - ttl_ms;

    let mut turns: Vec<&LedgerEntry> = entries.iter().filter(|e| e.kind == "turn").collect();
    turns.sort_by_key(|e| (e.seal_ts, e.ts));
    let keep_from = turns.len().saturating_sub(keep);
    let line = turns.get(keep_from).map(|e| e.seal_ts).unwrap_or(i64::MAX);
    let cutoff = cutoff.max(line);
    let kept_turns: std::collections::BTreeSet<String> = turns
        .iter()
        .filter(|e| e.seal_ts >= cutoff)
        .map(|e| e.id.clone())
        .collect();

    // 各会话最新 anchor(open 轮的基线 + 其 edit 行)不可丢
    let mut latest_anchor: BTreeMap<String, &LedgerEntry> = BTreeMap::new();
    for e in entries.iter().filter(|e| e.kind == "anchor") {
        let key = if e.session_id.is_empty() {
            e.tmd_session_id.clone()
        } else {
            e.session_id.clone()
        };
        match latest_anchor.get(&key) {
            Some(prev) if prev.turn > e.turn => {}
            _ => {
                latest_anchor.insert(key, e);
            }
        }
    }

    let kept: Vec<LedgerEntry> = entries
        .iter()
        .filter(|e| match e.kind.as_str() {
            "turn" => kept_turns.contains(&e.id),
            "edit" => {
                // edit 行归属 open 轮(其 anchor 是某会话最新锚点)时保留
                latest_anchor.values().any(|a| a.id == e.id)
            }
            "anchor" => {
                kept_turns.contains(&e.id)
                    || latest_anchor
                        .get(&session_key(e))
                        .is_some_and(|a| a.id == e.id)
            }
            "guard" => kept_turns.contains(&e.batch_id),
            _ => false,
        })
        .cloned()
        .collect();
    let dropped = entries.len() - kept.len();
    // dropped == 0 也继续:条目没变仍可能需要清对象(历史遗留孤儿),不提前返回。
    rewrite_ledger(cwd, &kept)?;

    // 悬空 states 一并清理
    let kept_ids: std::collections::BTreeSet<String> = kept
        .iter()
        .filter(|e| e.kind == "anchor")
        .map(|e| e.id.clone())
        .collect();
    let mut states = load_states(cwd);
    states.batches.retain(|id, _| kept_ids.contains(id));
    save_states(cwd, &states)?;

    // sidecar 对象库 reachability 清理:保留条目引用的 oid 之外全删
    prune_sidecar_objects(cwd, &kept)?;

    Ok(dropped)
}

/// sidecar 裸仓库的 blob 清理:直删未被保留条目引用的 loose object 文件
/// (sidecar 只写 blob 永不 pack,objects/ 下即 loose 布局;git2 Odb 无删除
/// API,文件级删除等价)。引用集 = anchor/guard 的 files[].oid + edit 的
/// before/snap + turn 的前后像(base_oid 是用户仓库对象,不在此列)。
fn prune_sidecar_objects(cwd: &str, kept: &[LedgerEntry]) -> Result<(), CkptError> {
    let sidecar = open_sidecar(cwd)?;
    let mut keep_oids: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for e in kept {
        match e.kind.as_str() {
            "anchor" | "guard" => {
                for f in &e.files {
                    if !f.oid.is_empty() {
                        keep_oids.insert(f.oid.clone());
                    }
                }
            }
            "edit" => {
                for oid in [&e.before_oid, &e.snap_oid] {
                    if !oid.is_empty() {
                        keep_oids.insert(oid.clone());
                    }
                }
            }
            "turn" => {
                for tf in &e.turn_files {
                    for oid in [&tf.before_oid, &tf.after_oid] {
                        if !oid.is_empty() {
                            keep_oids.insert(oid.clone());
                        }
                    }
                }
            }
            _ => {}
        }
    }
    let objects_dir = sidecar.path().join("objects");
    for dir in fs::read_dir(&objects_dir)? {
        let dir = dir?;
        let prefix = dir.file_name().to_string_lossy().into_owned();
        if prefix.len() != 2 || !prefix.chars().all(|c| c.is_ascii_hexdigit()) {
            continue;
        }
        for file in fs::read_dir(dir.path())? {
            let file = file?;
            let name = file.file_name().to_string_lossy().into_owned();
            if name.len() != 38 {
                continue;
            }
            let oid = format!("{prefix}{name}");
            // 单个删除失败不致命(并发写入的瞬态对象);下次 prune 再清
            if !keep_oids.remove(&oid) {
                let _ = fs::remove_file(file.path());
            }
        }
    }
    Ok(())
}

fn session_key(e: &LedgerEntry) -> String {
    if e.session_id.is_empty() {
        e.tmd_session_id.clone()
    } else {
        e.session_id.clone()
    }
}
