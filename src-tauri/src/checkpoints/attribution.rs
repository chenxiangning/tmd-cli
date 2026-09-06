//! git 归因的窗口推断 —— events 之外的唯一归因信号源。
//!
//! 仅未声明写入事件检测的 CLI(kimi/qoder 等无信号源者)全程走此路径封口
//! 与 open 视图;events 会话不进本模块(纯 edit 行归因,见 events.rs)。
//! 规则:候选 = live dirty ∪ anchor 基线路径,内容对照锚点基线判变;
//! 归属仲裁按写入时刻(mtime)三道闸,均宁漏勿串:
//! 1. 认领优先:外会话锚点窗口内已认领的路径(封口批 turn_files ∪ events
//!    链 edit 行),我方不再重复归属 —— 同文件多批重复认领的根治;
//! 2. 落窗最近提示者赢:mtime 落进谁的窗口归谁,无窗口可容纳(时钟异常)
//!    回退"外会话已封口认领则不归我";
//! 3. 僵尸封顶:开放锚点窗口超 STALE_OPEN_MS 视为关闭,死锚点不吞新写入。
//!
//! mtime 只证明「何时被写」不证明「谁写的」,并行轮次重叠期的无主写入
//! 归属仍是结构性歧义(既有批先认领优先缓解);出路是 CLI 声明 events 信号源。

use super::ledger::empty_patch;
use super::{
    blob_patch, dirty_paths, head_blob_bytes, now_millis, resolve_snap_bytes, write_sidecar_blob,
    CkptError, LedgerEntry, TurnFile,
};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;

/// 并行会话归属仲裁(按写入时刻,非封口先后):
/// 外会话在本锚点开启后封口、且其批内认领的路径,视为他人所有 —— mtime
/// 不可得时的兜底仲裁,防止把别人窗口内的写入算到自己头上。
fn foreign_claims(entries: &[LedgerEntry], anchor: &LedgerEntry) -> BTreeSet<String> {
    entries
        .iter()
        .filter(|e| e.kind == "turn" && e.session_id != anchor.session_id && e.seal_ts > anchor.ts)
        .flat_map(|e| e.turn_files.iter().map(|tf| tf.path.clone()))
        .collect()
}

/// 外会话认领窗口:(窗口起点, 窗口终点, 认领路径集)。
/// 认领 = 正面归属证据:封口批的 turn_files 与 events 链的 edit 行路径,
/// 归其锚点窗口 [锚点 ts, 封口 ts(未封口 = 僵尸封顶)] 所有。我方窗口推断
/// 撞上认领窗口即让路 —— 先封者认领后,后封者按 mtime 再抢一次是同一文件
/// 被多个会话批次重复认领的根因;events 会话的在途 edit 行路径同样受保护,
/// 无信号源的 git 会话不得抢事件链已认领的文件。
fn foreign_claim_windows(
    entries: &[LedgerEntry],
    anchor: &LedgerEntry,
    now: i64,
) -> Vec<(i64, i64, BTreeSet<String>)> {
    let mut out: Vec<(i64, i64, BTreeSet<String>)> = Vec::new();
    for a in entries
        .iter()
        .filter(|e| e.kind == "anchor" && e.session_id != anchor.session_id)
    {
        let end = entries
            .iter()
            .rfind(|e| e.kind == "turn" && e.id == a.id)
            .map(|t| t.seal_ts)
            .unwrap_or_else(|| now.min(a.ts + super::ledger::STALE_OPEN_MS))
            .max(a.ts);
        let mut paths: BTreeSet<String> = entries
            .iter()
            .filter(|e| e.kind == "edit" && e.id == a.id)
            .map(|e| e.path.clone())
            .collect();
        for t in entries.iter().filter(|e| e.kind == "turn" && e.id == a.id) {
            paths.extend(t.turn_files.iter().map(|tf| tf.path.clone()));
        }
        if !paths.is_empty() {
            out.push((a.ts, end, paths));
        }
    }
    out
}

/// 会话活动窗口(归属仲裁的时间线):每个 anchor 一条,
/// end = 该锚点最后一版 turn 的封口 ts,尚无 turn = min(now, 僵尸封顶)
/// —— 开放窗口不再无限延伸,昨天的死锚点不再吞今天的写入。
fn session_windows(entries: &[LedgerEntry], now: i64) -> Vec<(i64, i64, &str)> {
    entries
        .iter()
        .filter(|e| e.kind == "anchor")
        .map(|a| {
            let end = entries
                .iter()
                .rfind(|e| e.kind == "turn" && e.id == a.id)
                .map(|t| t.seal_ts)
                .unwrap_or_else(|| now.min(a.ts + super::ledger::STALE_OPEN_MS));
            (a.ts, end.max(a.ts), a.session_id.as_str())
        })
        .collect()
}

/// 文件写入时刻(fs mtime,ms);不可得(已删/时钟异常)返回 None。
fn path_mtime(root: &std::path::Path, path: &str) -> Option<i64> {
    let t = fs::metadata(root.join(path)).ok()?.modified().ok()?;
    let d = t.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(d.as_millis() as i64)
}

/// 锚点以来的真实变更集(封口与 open 视图共用):
/// 候选 = live dirty ∪ anchor 基线路径;内容可比的比内容,不可知的按条目语义;
/// 并行归属按 mtime 三道闸仲裁(认领优先 → 落窗最近提示者赢 → 无主回退
/// 认领规则),宁漏勿串。返回 (path, live 状态符) 按路径排序。
pub(super) fn turn_changed_paths(
    sidecar: &git2::Repository,
    user: Option<&git2::Repository>,
    root: &std::path::Path,
    anchor: &LedgerEntry,
    live: &BTreeMap<String, String>,
    entries: &[LedgerEntry],
) -> Result<Vec<(String, String)>, CkptError> {
    let anchor_files = &anchor.files;
    let now = now_millis();
    let windows = session_windows(entries, now);
    let claim_windows = foreign_claim_windows(entries, anchor, now);
    let claims = foreign_claims(entries, anchor);
    let mut candidates = BTreeSet::new();
    for p in live.keys() {
        candidates.insert(p.clone());
    }
    for f in anchor_files {
        candidates.insert(f.path.clone());
    }
    let mut changed = Vec::new();
    for p in candidates {
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
            Some((ab, _)) => live_bytes.as_deref() != Some(ab.as_slice()),
            None => true,
        };
        if !is_changed {
            continue;
        }
        // 归属仲裁:mtime 落进外会话认领窗口 = 他账正面认领,让路不重复归属;
        // 否则按 mtime 落谁的窗口归谁(最近提示者赢);无窗口可容纳(时钟异常)
        // 或删除态(mtime 不可得)回退"外会话已封口认领则不归我"。
        let is_mine = match path_mtime(root, &p) {
            Some(m)
                if claim_windows
                    .iter()
                    .any(|(s, e, ps)| s <= &m && &m <= e && ps.contains(&p)) =>
            {
                false
            }
            Some(m) => match windows
                .iter()
                .filter(|(s, e, _)| s <= &m && &m <= e)
                .max_by_key(|(s, _, _)| *s)
            {
                Some((_, _, owner)) => owner == &anchor.session_id,
                None => !claims.contains(&p), // 无窗口可容纳(时钟异常):退回认领规则
            },
            // 删除态(mtime 不可得):外会话窗口重叠期内已封口认领则不归我
            None => !claims.contains(&p),
        };
        if is_mine {
            let status = live.get(&p).cloned().unwrap_or_else(|| "M".into());
            changed.push((p, status));
        }
    }
    Ok(changed)
}

/// git 归因封口:窗口推断变更集 → 逐文件前后像 + diff。
pub(super) fn build_git_turn_files(
    sidecar: &git2::Repository,
    user: &git2::Repository,
    root: &std::path::Path,
    anchor: &LedgerEntry,
    entries: &[LedgerEntry],
) -> Result<Vec<TurnFile>, CkptError> {
    let live = dirty_paths(user)?;
    let changed = turn_changed_paths(sidecar, Some(user), root, anchor, &live, entries)?;
    let mut tfs = Vec::with_capacity(changed.len());
    for (path, _) in changed {
        if let Some(tf) = git_turn_file(sidecar, user, root, anchor, &path)? {
            tfs.push(tf);
        }
    }
    Ok(tfs)
}

/// 单路径 TurnFile:前像 = 锚点基线(anchor 基线 → HEAD 兜底),后像 = 磁盘;
/// 等值短路返回 None 不入批。git 归因主路径与 events 归因的 shell 落盘
/// 补充路径共用本语义(回退/应用行为一致)。
pub(super) fn git_turn_file(
    sidecar: &git2::Repository,
    user: &git2::Repository,
    root: &std::path::Path,
    anchor: &LedgerEntry,
    path: &str,
) -> Result<Option<TurnFile>, CkptError> {
    let entry = anchor.files.iter().find(|f| f.path == path);
    // 批前像:existed 语义优先于内容解析(锚点时已删的文件,回退 = 删除而非复活旧基线)
    let existed_before = match entry {
        Some(e) => e.existed,
        None => head_has(user, path)?,
    };
    let before = if existed_before {
        resolve_snap_bytes(sidecar, Some(user), &anchor.files, path)?
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
    let meta_exists = root.join(path).symlink_metadata().is_ok();
    let (after, existed_after, after_skip) = match fs::read(root.join(path)) {
        Ok(bytes) => (Some(bytes), true, None),
        Err(_) if meta_exists => (None, true, Some("读取失败".to_string())),
        Err(_) => (None, false, None),
    };
    if before.as_ref().map(|b| &b.0) == after.as_ref() {
        return Ok(None); // 等值短路(changed 判定已滤,双保险)
    }
    let status = match (existed_before, existed_after) {
        (false, true) => "A",
        (true, false) => "D",
        _ => "M",
    };
    let patch = if before_skip.is_some() || after_skip.is_some() {
        empty_patch(path, status)
    } else {
        blob_patch(
            sidecar,
            path,
            before.as_ref().map(|b| b.0.as_slice()),
            after.as_deref(),
        )?
    };
    let before_oid = match &before {
        Some((bytes, _)) if before_skip.is_none() => write_sidecar_blob(sidecar, bytes)?,
        _ => String::new(),
    };
    let after_oid = match &after {
        Some(bytes) if after_skip.is_none() => write_sidecar_blob(sidecar, bytes)?,
        _ => String::new(),
    };
    Ok(Some(TurnFile {
        path: path.to_string(),
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
        edit_count: 0,
    }))
}

fn head_has(user: &git2::Repository, path: &str) -> Result<bool, CkptError> {
    Ok(head_blob_bytes(Some(user), path)?.is_some())
}
