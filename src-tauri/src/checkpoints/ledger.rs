//! 账本操作 —— 记账(anchor)与封口(seal);视图(list)/保留策略(prune)在 view。
//!
//! 核心不变量:**归因在封口瞬间定死,list 只读账本**。
//! 每条 anchor 记第 N 轮开始前的工作区基线;seal 把「基线 → 当前工作区」的
//! 逐文件变更(前后像 blob + unified diff)固化成 turn 条目,追加进 ledger.jsonl
//! (同一 id 可修订追加,读取取最后一行)。因此并行会话/连续轮次不会再共享
//! 同一份"全工作区脏集"推导 —— 每轮绑定的文件集合只含本窗口内的真实变更。
//!
//! 会话身份:锚点常发生在 CLI 磁盘身份绑定之前,先以 tmd 会话 id 记账;
//! 绑定后(anchor/seal 时)把同名 tmd id 的历史条目回填为 CLI id,
//! 查询按 (session_id, tmd_session_id) 双字段命中,单次查询即可取全链。

use super::{
    append_ledger, entry_in_session, load_ledger, new_entry_id, now_millis, open_sidecar,
    open_user, resolve_snap_bytes, rewrite_ledger, write_sidecar_blob, CkptError, LedgerEntry,
    SnapFile, TurnFile,
};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;

/// 账本入口:记录第 N 轮锚点。隐式先封上一轮(防 turnSettled 丢失导致窗口跨轮),
/// 再做身份回填,最后抓基线落账。返回新锚点条目(含分配的轮次)。
pub fn anchor_turn(
    cwd: &str,
    session_id: &str,
    tmd_session_id: &str,
    prompt: &str,
) -> Result<LedgerEntry, CkptError> {
    let _g = super::lock_ledger();
    let mut entries = load_ledger(cwd);
    backfill_identity(cwd, &mut entries, session_id, tmd_session_id)?;

    seal_locked(cwd, session_id, tmd_session_id, &entries)?;

    let turn = next_turn(&entries, session_id, tmd_session_id);
    let ts = now_millis();
    let entry = LedgerEntry {
        id: new_entry_id(ts),
        kind: "anchor".into(),
        ts,
        session_id: session_id.to_string(),
        tmd_session_id: tmd_session_id.to_string(),
        turn,
        prompt: prompt.chars().take(4000).collect(),
        files: super::snapshot_files(cwd)?,
        ..Default::default()
    };
    append_ledger(cwd, &entry)?;
    Ok(entry)
}

/// 显式封口(turnSettled):把最新锚点以来的变更固化成 turn 条目。
/// 返回是否落账。封口后、下一锚点前若继续改动,再次 seal 会以修订追加
/// (视图取最后一行),该条目直到下一锚点落地才冻结。
pub fn seal_turn(cwd: &str, session_id: &str, tmd_session_id: &str) -> Result<bool, CkptError> {
    let _g = super::lock_ledger();
    let entries = load_ledger(cwd);
    seal_locked(cwd, session_id, tmd_session_id, &entries)
}

// ---- 内部 ------------------------------------------------------------------

/// 身份回填:CLI 身份绑定后,把仍记在 tmd id 名下的历史条目改归 CLI id
/// (一次整文件重写;条目顺序与内容不变)。只在主副键不同(确已绑定)时执行。
fn backfill_identity(
    cwd: &str,
    entries: &mut Vec<LedgerEntry>,
    session_id: &str,
    tmd_session_id: &str,
) -> Result<(), CkptError> {
    if session_id == tmd_session_id || tmd_session_id.is_empty() {
        return Ok(());
    }
    let mut changed = false;
    for e in entries.iter_mut() {
        if e.session_id == tmd_session_id {
            e.session_id = session_id.to_string();
            changed = true;
        }
    }
    if changed {
        rewrite_ledger(cwd, entries)?;
    }
    Ok(())
}

/// 会话内下一个轮次 = 已有锚点最大轮次 + 1。
fn next_turn(entries: &[LedgerEntry], session_id: &str, tmd_session_id: &str) -> u64 {
    entries
        .iter()
        .filter(|e| e.kind == "anchor" && entry_in_session(e, session_id, tmd_session_id))
        .map(|e| e.turn)
        .max()
        .unwrap_or(0)
        + 1
}

/// 并行会话归属仲裁:其他会话已认领的路径(封口时刻晚于本窗口锚点 = 窗口重叠)
/// 不再重复归属 —— 共享工作区里同一份改动只进先封口那会话的账;
/// 本会话后续轮次窗口不再重叠,可重新认领。
pub(super) fn foreign_claims(entries: &[LedgerEntry], anchor: &LedgerEntry) -> BTreeSet<String> {
    entries
        .iter()
        .filter(|e| {
            e.kind == "turn"
                && e.session_id != anchor.session_id
                && e.seal_ts > anchor.ts
        })
        .flat_map(|e| e.turn_files.iter().map(|tf| tf.path.clone()))
        .collect()
}

/// 锚点以来的真实变更集(封口与 open 视图共用):
/// 候选 = live dirty ∪ anchor 基线路径;内容可比的比内容,不可知的按条目语义。
/// exclude = 其他会话已认领的路径(并行仲裁)。返回 (path, live 状态符) 按路径排序。
pub(super) fn turn_changed_paths(
    sidecar: &git2::Repository,
    user: &git2::Repository,
    root: &std::path::Path,
    anchor_files: &[SnapFile],
    live: &BTreeMap<String, String>,
    exclude: &BTreeSet<String>,
) -> Result<Vec<(String, String)>, CkptError> {
    let mut candidates = std::collections::BTreeSet::new();
    for p in live.keys() {
        candidates.insert(p.clone());
    }
    for f in anchor_files {
        candidates.insert(f.path.clone());
    }
    let mut changed = Vec::new();
    for p in candidates {
        if exclude.contains(&p) {
            continue; // 其他会话窗口重叠期内已认领:不重复归属
        }
        let entry = anchor_files.iter().find(|f| f.path == p);
        if let Some(e) = entry {
            // anchor 时刻内容不可知(超大/符号链接/冲突/读失败):不归因,
            // 否则 skip 文件会凭 index 基线每轮被重复归属
            if e.skip.is_some() {
                continue;
            }
            // anchor 时刻已删:现在也无内容(仍处于删除态)= 未变;重建则照常判变
            if !e.existed && fs::read(root.join(&p)).is_err() {
                continue;
            }
        }
        let anchor_bytes = resolve_snap_bytes(sidecar, user, anchor_files, &p)?;
        let live_bytes = fs::read(root.join(&p)).ok();
        let is_changed = match anchor_bytes {
            // anchor 内容可知(工作区 blob / index / HEAD 兜底):直接比内容
            Some((ab, _)) => live_bytes.as_deref() != Some(ab.as_slice()),
            // 内容不可知但语义明确:anchor 记录为已删 → 现在存在 = 轮内重建;
            // anchor 未记录 → 候选必来自 live dirty = 轮内新建
            None => true,
        };
        if is_changed {
            let status = live.get(&p).cloned().unwrap_or_else(|| "M".into());
            changed.push((p, status));
        }
    }
    Ok(changed)
}

/// 封口:最新锚点 → turn 条目(修订追加)。零差异不落账。
fn seal_locked(
    cwd: &str,
    session_id: &str,
    tmd_session_id: &str,
    entries: &[LedgerEntry],
) -> Result<bool, CkptError> {
    let anchor = entries
        .iter()
        .filter(|e| e.kind == "anchor" && entry_in_session(e, session_id, tmd_session_id))
        .max_by_key(|e| (e.turn, e.ts));
    let Some(a) = anchor else {
        return Ok(false);
    };
    let entry = build_turn_entry(cwd, a, session_id, tmd_session_id, entries)?;
    match entry {
        Some(e) => {
            append_ledger(cwd, &e)?;
            Ok(true)
        }
        None => Ok(false),
    }
}

/// 由锚点基线 + live 工作区构建 turn 条目(逐文件前后像 + diff 固化)。
fn build_turn_entry(
    cwd: &str,
    anchor: &LedgerEntry,
    session_id: &str,
    tmd_session_id: &str,
    entries: &[LedgerEntry],
) -> Result<Option<LedgerEntry>, CkptError> {
    let sidecar = open_sidecar(cwd)?;
    let user = open_user(cwd)?;
    let root = std::path::PathBuf::from(cwd);
    let live = super::dirty_paths(&user)?;
    let exclude = foreign_claims(entries, anchor);
    let changed = turn_changed_paths(&sidecar, &user, &root, &anchor.files, &live, &exclude)?;
    if changed.is_empty() {
        return Ok(None);
    }
    let prev = entries
        .iter()
        .filter(|e| e.kind == "turn" && e.id == anchor.id)
        .next_back();

    let mut turn_files = Vec::with_capacity(changed.len());
    for (path, _) in changed {
        let entry = anchor.files.iter().find(|f| f.path == path);
        // 批前像:existed 语义优先于内容解析(锚点时已删的文件,回退 = 删除而非复活旧基线)
        let existed_before = match entry {
            Some(e) => e.existed,
            None => head_has(&user, &path)?,
        };
        let before = if existed_before {
            resolve_snap_bytes(&sidecar, &user, &anchor.files, &path)?
        } else {
            None
        };
        // 前像不可得(skip 且无基线):diff/回退都跳过,只记状态
        let before_skip = match entry {
            Some(e) if existed_before && before.is_none() => e
                .skip
                .clone()
                .filter(|s| !s.is_empty())
                .or_else(|| Some("前像缺失".into())),
            _ => None,
        };
        let meta_exists = root.join(&path).symlink_metadata().is_ok();
        let (after, existed_after, after_skip) = match fs::read(root.join(&path)) {
            Ok(bytes) => (Some(bytes), true, None),
            Err(_) if meta_exists => (None, true, Some("读取失败".to_string())),
            Err(_) => (None, false, None),
        };
        if before.as_ref().map(|b| &b.0) == after.as_ref() {
            continue; // 等值短路(changed 判定已滤,双保险)
        }
        let status = match (existed_before, existed_after) {
            (false, true) => "A",
            (true, false) => "D",
            _ => "M",
        };
        let patch = if before_skip.is_some() || after_skip.is_some() {
            super::CkptPatch {
                path: path.clone(),
                kind: status.into(),
                additions: 0,
                deletions: 0,
                patch: String::new(),
                binary: false,
            }
        } else {
            super::blob_patch(
                &sidecar,
                &path,
                before.as_ref().map(|b| b.0.as_slice()),
                after.as_deref(),
            )?
        };
        let before_oid = match &before {
            Some((bytes, _)) if before_skip.is_none() => write_sidecar_blob(&sidecar, bytes)?,
            _ => String::new(),
        };
        let after_oid = match &after {
            Some(bytes) if after_skip.is_none() => write_sidecar_blob(&sidecar, bytes)?,
            _ => String::new(),
        };
        turn_files.push(TurnFile {
            path,
            status: status.into(),
            before_oid,
            after_oid,
            existed_before,
            existed_after,
            additions: patch.additions,
            deletions: patch.deletions,
            binary: patch.binary,
            patch: patch.patch,
            skip: before_skip.or(after_skip),
        });
    }
    if turn_files.is_empty() {
        return Ok(None);
    }
    // 幂等:与最近一次修订完全一致(结算事件可能重复触发)不追加冗余行
    if let Some(p) = prev {
        if same_revision(&p.turn_files, &turn_files) {
            return Ok(None);
        }
    }

    Ok(Some(LedgerEntry {
        id: anchor.id.clone(),
        kind: "turn".into(),
        ts: anchor.ts,
        session_id: session_id.to_string(),
        tmd_session_id: tmd_session_id.to_string(),
        turn: anchor.turn,
        prompt: anchor.prompt.clone(),
        seal_ts: now_millis(),
        batch_id: String::new(),
        files: Vec::new(),
        turn_files,
    }))
}

fn head_has(user: &git2::Repository, path: &str) -> Result<bool, CkptError> {
    Ok(super::head_blob_bytes(user, path)?.is_some())
}

/// 两次封口修订是否同一变更集(前后像 oid 一致即视为相同)。
fn same_revision(a: &[TurnFile], b: &[TurnFile]) -> bool {
    a.len() == b.len()
        && a.iter().zip(b.iter()).all(|(x, y)| {
            x.path == y.path
                && x.status == y.status
                && x.before_oid == y.before_oid
                && x.after_oid == y.after_oid
                && x.additions == y.additions
                && x.deletions == y.deletions
        })
}

