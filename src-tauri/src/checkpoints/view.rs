//! 账本视图与保留策略 —— list 只读渲染、批 diff 导出、prune 清理。
//!
//! list 是纯读:sealed 批直接取账本 turn 条目(文件集合封口即定死),再做
//! live 分类(未动/内容已变/已提交);open 轮只属于各会话最新锚点,
//! 只列本窗口内的真实变更。批 diff:sealed 零重算(open 按需现算)。

use super::ledger::{foreign_claims, turn_changed_paths};
use super::{
    entry_in_session, load_ledger, load_states, now_millis, open_sidecar, open_user,
    rewrite_ledger, save_states, BatchFile, BatchInfo, CkptError, LedgerEntry, TurnFile,
};
use std::collections::BTreeMap;
use std::fs;

/// 会话视图:锚点序列 + turn 条目 + live 分类 → BatchInfo 列表(新 → 旧)。
/// 纯读:封口零差异的轮不出现;open 轮只列本窗口内真实变更的路径。
pub fn derive_batches(
    cwd: &str,
    session_id: &str,
    tmd_session_id: &str,
) -> Result<Vec<BatchInfo>, CkptError> {
    let _g = super::lock_ledger();
    let entries = load_ledger(cwd);
    let states = load_states(cwd);

    let user = open_user(cwd)?;
    let live = super::dirty_paths(&user)?;
    let sidecar = open_sidecar(cwd)?;
    let root = std::path::PathBuf::from(cwd);

    let mut anchors: Vec<&LedgerEntry> = entries
        .iter()
        .filter(|e| e.kind == "anchor" && entry_in_session(e, session_id, tmd_session_id))
        .collect();
    anchors.sort_by_key(|e| (e.turn, e.ts));

    let mut out = Vec::new();
    let last_anchor = anchors.len().saturating_sub(1);
    for (ai, a) in anchors.iter().enumerate() {
        let turn_entry = entries
            .iter()
            .filter(|e| e.kind == "turn" && e.id == a.id)
            .next_back();
        let stored = states.batches.get(&a.id);

        let (files, open, ts_end) = match turn_entry {
            Some(t) => {
                let mut files = Vec::new();
                for tf in &t.turn_files {
                    let reverted = stored
                        .map(|s| s.reverted_paths.iter().any(|p| p == &tf.path))
                        .unwrap_or(false);
                    let live_state = if reverted {
                        "reverted".to_string()
                    } else {
                        classify_turn_file(&sidecar, &root, tf, &live)?
                    };
                    files.push(BatchFile {
                        stale: live_state == "changed",
                        path: tf.path.clone(),
                        status: tf.status.clone(),
                        reverted,
                        live: live_state,
                    });
                }
                (files, false, Some(t.seal_ts))
            }
            None => {
                // 只有最新锚点才是 open 轮;历史锚点无 turn 条目 = 纯阅读轮,不出现
                if ai != last_anchor {
                    continue;
                }
                let exclude = foreign_claims(&entries, a);
                let changed = turn_changed_paths(&sidecar, &user, &root, &a.files, &live, &exclude)?;
                if changed.is_empty() {
                    continue; // 本轮尚无变更:不上时间线(纯阅读轮同理,永不出现)
                }
                let files = changed
                    .into_iter()
                    .map(|(p, st)| BatchFile {
                        stale: false,
                        reverted: false,
                        path: p,
                        status: untrack_char(&st),
                        live: "same".into(),
                    })
                    .collect();
                (files, true, None)
            }
        };

        let reverted = stored.map(|s| s.state == "reverted").unwrap_or(false);
        let approved = stored.map(|s| s.state == "approved").unwrap_or(false);
        let any_committed = !open && files.iter().any(|f| f.live == "committed");
        let all_processed = !open && !files.is_empty() && files.iter().all(|f| f.live != "same");
        let (state, done_reason) = if reverted {
            ("reverted".into(), None)
        } else if open {
            ("pending".into(), None)
        } else if all_processed {
            // 自动已处理(已提交/内容已变)优先于通过标记 —— 事实胜于标记
            (
                "done".into(),
                Some(if any_committed { "已提交".into() } else { "内容已变".into() }),
            )
        } else if approved {
            ("approved".into(), None)
        } else {
            ("pending".into(), None)
        };

        out.push(BatchInfo {
            id: a.id.clone(),
            index: a.turn,
            open,
            ts: a.ts,
            ts_end,
            session_id: a.session_id.clone(),
            prompt: a.prompt.clone(),
            state,
            done_reason,
            guard_id: stored.and_then(|s| s.guard_id.clone()),
            files,
        });
    }
    out.reverse(); // UI 倒序(最新在前)
    Ok(out)
}

/// 保留策略:每 cwd 保最近 keep 个 turn 批 + TTL 内的批;对应 anchor/guard 随批保留,
/// 各会话尚未封口的最新 anchor 一并保留。返回移除的条目数。
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

    // 各会话最新 anchor(open 轮的基线)不可丢
    let mut latest_anchor: BTreeMap<String, &LedgerEntry> = BTreeMap::new();
    for e in entries.iter().filter(|e| e.kind == "anchor") {
        let key = if e.session_id.is_empty() { e.tmd_session_id.clone() } else { e.session_id.clone() };
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
    if dropped == 0 {
        return Ok(0);
    }
    rewrite_ledger(cwd, &kept)?;

    // 悬空 states 一并清理
    let kept_ids: std::collections::BTreeSet<String> =
        kept.iter().filter(|e| e.kind == "anchor").map(|e| e.id.clone()).collect();
    let mut states = load_states(cwd);
    states.batches.retain(|id, _| kept_ids.contains(id));
    save_states(cwd, &states)?;
    Ok(dropped)
}

/// 批次逐文件 patch:sealed 批直接读账本固化的 diff(封口瞬间定死,零重算);
/// open 批新像 = live 工作区,按需现算(时间线 ± 与审阅单共用)。
pub fn batch_patches(cwd: &str, batch_id: &str) -> Result<Vec<super::CkptPatch>, CkptError> {
    let _g = super::lock_ledger();
    let entries = load_ledger(cwd);
    if let Some(t) = entries
        .iter()
        .filter(|e| e.kind == "turn" && e.id == batch_id)
        .next_back()
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
    let user = open_user(cwd)?;
    let root = std::path::PathBuf::from(cwd);
    let live = super::dirty_paths(&user)?;
    let exclude = foreign_claims(&entries, a);
    let changed = turn_changed_paths(&sidecar, &user, &root, &a.files, &live, &exclude)?;
    let paths: Vec<String> = changed.into_iter().map(|(p, _)| p).collect();
    super::open_batch_patches(cwd, &a.files, &paths)
}

fn session_key(e: &LedgerEntry) -> String {
    if e.session_id.is_empty() { e.tmd_session_id.clone() } else { e.session_id.clone() }
}

/// 封口批单文件 live 分类(对照账本固化的批后像):
/// 同容 → same(未动,可回退)| 已入 git → committed | 失配 → changed。
fn classify_turn_file(
    sidecar: &git2::Repository,
    root: &std::path::Path,
    tf: &TurnFile,
    live: &BTreeMap<String, String>,
) -> Result<String, CkptError> {
    let after = if tf.after_oid.is_empty() {
        None
    } else {
        let oid = git2::Oid::from_str(&tf.after_oid)?;
        Some(sidecar.find_blob(oid)?.content().to_vec())
    };
    let live_bytes = fs::read(root.join(&tf.path)).ok();
    match (after, live_bytes) {
        (None, None) => Ok("committed".into()),  // 批后已删,现在也没有 = 已处理
        (None, Some(_)) => Ok("changed".into()), // 批后已删/不可知,现在有内容
        (Some(a), Some(l)) => {
            if a != l {
                Ok("changed".into())
            } else if live.contains_key(&tf.path) {
                // 内容 == 批后像但仍是 dirty:自封口起没人动过 → 待审未动,可回退
                Ok("same".into())
            } else {
                // 干净且 == 批后像 = 已随提交进入 git(或被外部还原)
                Ok("committed".into())
            }
        }
        (Some(_), None) => {
            // 批后有内容,现在没了:不在 dirty 集 = 被 commit 后又 revert 掉,视为已处理;
            // 在 dirty 集 = 工作区删除,内容已变
            Ok(if live.contains_key(&tf.path) { "changed".into() } else { "committed".into() })
        }
    }
}

fn untrack_char(status: &str) -> String {
    // untracked 在 live 状态里是 "?",批次文件展示沿用 A(新增)
    if status == "?" { "A".into() } else { status.to_string() }
}
