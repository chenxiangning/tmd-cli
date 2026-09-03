//! 账本操作 —— 记账(anchor/edit)与封口(seal);视图(list)/保留策略(prune)在 view。
//!
//! 核心不变量:**归因在封口瞬间定死,list 只读账本**。
//! 每条 anchor 记第 N 轮开始前的工作区基线;seal 把「基线 → 当前工作区」的
//! 逐文件变更(前后像 blob + unified diff)固化成 turn 条目,追加进 ledger.jsonl
//! (同一 id 可修订追加,读取取最后一行)。
//!
//! 双归因(作者设计点「审批线跟随 AI 输出落盘,不光靠 git」):
//! - events:AI 写入事件流(record_edit 流式记账)是归因主信号 —— 本轮碰过
//!   哪些文件由事件行定死,git 不参与归因;首击时抓前像拷成 sidecar 自足副本。
//! - git:未声明写入事件检测的 CLI 回退旧路径 —— 窗口内 dirty 推断 +
//!   mtime 落窗仲裁、最近提示者赢(turn_changed_paths)。
//! 归因模式随锚点固化(anchor.attribution),封口/视图按锚点分支。
//!
//! 会话身份:锚点常发生在 CLI 磁盘身份绑定之前,先以 tmd 会话 id 记账;
//! 绑定后(anchor/seal 时)把同名 tmd id 的历史条目回填为 CLI id,
//! 查询按 (session_id, tmd_session_id) 双字段命中,单次查询即可取全链。

use super::{
    append_ledger, entry_in_session, load_ledger, new_entry_id, now_millis, open_sidecar,
    open_user, resolve_snap_bytes, rewrite_ledger, write_sidecar_blob, CkptError, LedgerEntry,
    TurnFile,
};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;

/// 记第 N 轮锚点。隐式先封上一轮(防 turnSettled 丢失导致窗口跨轮),
/// 再做身份回填,最后抓基线落账。返回新锚点条目(含分配的轮次)。
/// engine/model/thinking = 发送时刻的引擎与状态快照,随锚点固化(历史批不随后续切换漂移)。
/// attribution = 归因模式("events" | "git"),由前端按 CLI profile 是否声明
/// 写入事件检测(editMarks)决定,随锚点定死。
pub fn anchor_turn(
    cwd: &str,
    session_id: &str,
    tmd_session_id: &str,
    prompt: &str,
    engine: &str,
    model: &str,
    thinking: &str,
    attribution: &str,
) -> Result<LedgerEntry, CkptError> {
    let _g = super::lock_ledger();
    let mut entries = load_ledger(cwd);
    backfill_identity(cwd, &mut entries, session_id, tmd_session_id)?;

    // 幽灵窗口收口:app 退出/崩溃会留下永远开放的锚点窗口,吞掉之后所有
    // 写入的归属。超时未封口的锚点代为封口(幂等;其链保持自身身份)。
    seal_stale_foreign(cwd, &mut entries)?;

    seal_locked(cwd, session_id, tmd_session_id, &entries)?;

    // 基线抓取:events 归因容错非 git 工作区(空基线,前像走 edit 自足副本);
    // git 归因必须有仓库(窗口推断全靠 dirty 集)。
    let (files, user_repo) = super::capture::snapshot_dirty(cwd)?;
    if user_repo.is_none() && attribution != "events" {
        return Err(super::CkptError::NotARepo(cwd.into()));
    }

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
        engine: engine.chars().take(200).collect(),
        model: model.chars().take(200).collect(),
        thinking: thinking.chars().take(200).collect(),
        files,
        attribution: attribution.to_string(),
        ..Default::default()
    };
    append_ledger(cwd, &entry)?;
    Ok(entry)
}

// events 归因的流式记账(record_edit)/封口(build_events_turn_files)已拆至
// events.rs(文件规模铁则);入口经 mod 重导出。

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
    let mut dirty = false;
    for e in entries.iter_mut() {
        if e.tmd_session_id == tmd_session_id && e.session_id != session_id {
            e.session_id = session_id.to_string();
            dirty = true;
        }
    }
    if dirty {
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

/// 并行会话归属仲裁(按写入时刻,非封口先后;仅 git 归因路径使用):
/// 每个锚点张成窗口 [锚点 ts, 封口 ts(未封口 = now)];文件 mtime 落在谁的
/// 窗口内,取**最近提示**(anchor ts 最大)的会话归主 —— 后提示的会话天然
/// 只对自己锚点之后的写入负责,先封口也不再抢走别人窗口内的改动。
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

/// 会话活动窗口(归属仲裁的时间线):每个 anchor 一条,
/// end = 该锚点最后一版 turn 的封口 ts,尚无 turn = now(仍开放)。
fn session_windows<'a>(entries: &'a [LedgerEntry], now: i64) -> Vec<(i64, i64, &'a str)> {
    entries
        .iter()
        .filter(|e| e.kind == "anchor")
        .map(|a| {
            let end = entries
                .iter()
                .filter(|e| e.kind == "turn" && e.id == a.id)
                .next_back()
                .map(|t| t.seal_ts)
                .unwrap_or(now);
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

/// 锚点以来的真实变更集(仅 git 归因;封口与 open 视图共用):
/// 候选 = live dirty ∪ anchor 基线路径;内容可比的比内容,不可知的按条目语义;
/// 并行归属按 mtime 窗口仲裁(mtime 不可得时回退"外会话封口认领"规则)。
/// 返回 (path, live 状态符) 按路径排序。
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
    let claims = foreign_claims(entries, anchor);
    let mut candidates = std::collections::BTreeSet::new();
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
        // 归属仲裁:mtime 落在谁的窗口 → 最近提示者赢;不是本会话则丢弃
        let is_mine = match path_mtime(root, &p) {
            Some(m) => match windows
                .iter()
                .filter(|(s, e, _)| s <= &m && &m <= e)
                .max_by_key(|(s, _, _)| s)
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

/// 幽灵窗口收口:外会话锚点超过 STALE_OPEN_MS 仍无 turn 条目(app 崩溃/强退
/// 所致)时,代其封口 —— 开放窗口不再无限吞掉后续写入的归属。
const STALE_OPEN_MS: i64 = 24 * 3600 * 1000;

fn seal_stale_foreign(cwd: &str, entries: &mut Vec<LedgerEntry>) -> Result<(), CkptError> {
    let now = now_millis();
    let stale: Vec<LedgerEntry> = entries
        .iter()
        .filter(|e| {
            e.kind == "anchor"
                && now - e.ts > STALE_OPEN_MS
                && !entries.iter().any(|t| t.kind == "turn" && t.id == e.id)
        })
        .cloned()
        .collect();
    for a in &stale {
        // 单条失败不阻断记账主流程(如某外会话工作区已被删除)
        if let Ok(Some(t)) = build_turn_entry(cwd, a, entries) {
            append_ledger(cwd, &t)?;
            entries.push(t);
        }
    }
    Ok(())
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
    let entry = build_turn_entry(cwd, a, entries)?;
    match entry {
        Some(e) => {
            append_ledger(cwd, &e)?;
            Ok(true)
        }
        None => Ok(false),
    }
}

/// 由锚点基线 + live 工作区构建 turn 条目(逐文件前后像 + diff 固化)。
/// 身份恒继承锚点:封口可能由任一事件触发,调用方身份在 CLI 绑定前后可能漂移
/// (cli id ↔ tmd id),随调用方会让同一锚点的链劈成两截。
///
/// 双归因:events 分支在 events.rs(build_events_turn_files),git 分支在下方。
fn build_turn_entry(
    cwd: &str,
    anchor: &LedgerEntry,
    entries: &[LedgerEntry],
) -> Result<Option<LedgerEntry>, CkptError> {
    let sidecar = open_sidecar(cwd)?;
    let user = open_user(cwd).ok();
    let root = std::path::PathBuf::from(cwd);
    let prev = entries
        .iter()
        .filter(|e| e.kind == "turn" && e.id == anchor.id)
        .next_back();

    let turn_files = if anchor.attribution == "events" {
        super::events::build_events_turn_files(&sidecar, &root, anchor, entries)?
    } else {
        let Some(user) = user.as_ref() else {
            return Ok(None); // git 归因 + 非 git:无 dirty 集可推断
        };
        build_git_turn_files(&sidecar, user, &root, anchor, entries)?
    };
    if turn_files.is_empty() {
        // events 归因:写过但净零(写了又写回)也要封口 —— 落一个空 turn 行
        // 把该轮关上(不再被视图当 open);纯阅读轮(无 edit 行)照旧不落账。
        if anchor.attribution == "events"
            && entries.iter().any(|e| e.kind == "edit" && e.id == anchor.id)
        {
            return Ok(Some(LedgerEntry {
                id: anchor.id.clone(),
                kind: "turn".into(),
                ts: anchor.ts,
                session_id: anchor.session_id.clone(),
                tmd_session_id: anchor.tmd_session_id.clone(),
                turn: anchor.turn,
                prompt: anchor.prompt.clone(),
                engine: anchor.engine.clone(),
                model: anchor.model.clone(),
                thinking: anchor.thinking.clone(),
                seal_ts: now_millis(),
                attribution: anchor.attribution.clone(),
                ..Default::default()
            }));
        }
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
        // 身份继承锚点(见 fn doc):链的归属以记账时刻为准,不随封口调用方漂移
        session_id: anchor.session_id.clone(),
        tmd_session_id: anchor.tmd_session_id.clone(),
        turn: anchor.turn,
        prompt: anchor.prompt.clone(),
        // 状态快照同继承锚点:同一批的视图无论读 anchor 还是 turn 都一致
        engine: anchor.engine.clone(),
        model: anchor.model.clone(),
        thinking: anchor.thinking.clone(),
        seal_ts: now_millis(),
        batch_id: String::new(),
        files: Vec::new(),
        turn_files,
        attribution: anchor.attribution.clone(),
        ..Default::default()
    }))
}

/// git 归因封口(原路径):窗口推断变更集 → 逐文件前后像 + diff。
fn build_git_turn_files(
    sidecar: &git2::Repository,
    user: &git2::Repository,
    root: &std::path::Path,
    anchor: &LedgerEntry,
    entries: &[LedgerEntry],
) -> Result<Vec<TurnFile>, CkptError> {
    let live = super::dirty_paths(user)?;
    let changed = turn_changed_paths(sidecar, Some(user), root, anchor, &live, entries)?;
    let mut tfs = Vec::with_capacity(changed.len());
    for (path, _) in changed {
        let entry = anchor.files.iter().find(|f| f.path == path);
        // 批前像:existed 语义优先于内容解析(锚点时已删的文件,回退 = 删除而非复活旧基线)
        let existed_before = match entry {
            Some(e) => e.existed,
            None => head_has(user, &path)?,
        };
        let before = if existed_before {
            resolve_snap_bytes(sidecar, Some(user), &anchor.files, &path)?
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
            empty_patch(&path, status)
        } else {
            super::blob_patch(
                sidecar,
                &path,
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
        tfs.push(TurnFile {
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
            edit_count: 0,
        });
    }
    Ok(tfs)
}

pub(super) fn empty_patch(path: &str, kind: &str) -> super::CkptPatch {
    super::CkptPatch {
        path: path.to_string(),
        kind: kind.into(),
        additions: 0,
        deletions: 0,
        patch: String::new(),
        binary: false,
    }
}

fn head_has(user: &git2::Repository, path: &str) -> Result<bool, CkptError> {
    Ok(super::head_blob_bytes(Some(user), path)?.is_some())
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
