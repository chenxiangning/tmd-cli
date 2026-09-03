//! 账本视图与保留策略 —— list 只读渲染、批 diff 导出、prune 清理。
//!
//! list 是纯读:sealed 批直接取账本 turn 条目(文件集合封口即定死),再做
//! live 分类(未动/内容已变/已提交);open 轮只属于各会话最新锚点,
//! 只列本窗口内的真实变更(events 归因 = edit 行集,git 归因 = 窗口推断)。
//! 批 diff:sealed 零重算(open 按需现算)。
//! 非 git 工作区:events 会话照常(前像自足);live 分类无 committed 档。

use super::attribution::turn_changed_paths;
use super::events::edit_open_paths;
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

    // 非 git 工作区:会话有账目(events 归因)→ 照常;无账目 → 维持旧灰化语义
    let user = match open_user(cwd) {
        Ok(r) => Some(r),
        Err(super::CkptError::NotARepo(_)) => {
            let mine = entries
                .iter()
                .any(|e| entry_in_session(e, session_id, tmd_session_id));
            if !mine {
                return Err(super::CkptError::NotARepo(cwd.into()));
            }
            None
        }
        Err(e) => return Err(e),
    };
    let live = match &user {
        Some(u) => super::dirty_paths(u)?,
        None => BTreeMap::new(),
    };
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
        let turn_entry = entries.iter().rfind(|e| e.kind == "turn" && e.id == a.id);
        let stored = states.batches.get(&a.id);

        let (files, open, ts_end) = match turn_entry {
            // 空净零封口行:轮已关(不是 open),但无变更不上时间线
            Some(t) if t.turn_files.is_empty() => continue,
            Some(t) => {
                let mut files = Vec::new();
                for tf in &t.turn_files {
                    let reverted = stored
                        .map(|s| s.reverted_paths.iter().any(|p| p == &tf.path))
                        .unwrap_or(false);
                    let live_state = if reverted {
                        "reverted".to_string()
                    } else {
                        classify_turn_file(&sidecar, &root, tf, &live, user.as_ref())?
                    };
                    files.push(BatchFile {
                        stale: live_state == "changed",
                        path: tf.path.clone(),
                        status: tf.status.clone(),
                        reverted,
                        live: live_state,
                        edit_count: tf.edit_count,
                    });
                }
                (files, false, Some(t.seal_ts))
            }
            None => {
                // 只有最新锚点才是 open 轮;历史锚点无 turn 条目 = 纯阅读轮,不出现
                if ai != last_anchor {
                    continue;
                }
                let changed = if a.attribution == "events" {
                    edit_open_paths(&root, &sidecar, user.as_ref(), &live, a, &entries)?
                } else {
                    let Some(u) = user.as_ref() else {
                        continue; // git 归因 + 非 git:无推断素材
                    };
                    turn_changed_paths(&sidecar, Some(u), &root, a, &live, &entries)?
                };
                if changed.is_empty() {
                    continue; // 本轮尚无变更:不上时间线(纯阅读轮同理,永不出现)
                }
                let edit_count_of = |p: &str| {
                    entries
                        .iter()
                        .find(|e| e.kind == "edit" && e.id == a.id && e.path == p)
                        .map(|e| e.edit_count)
                        .unwrap_or(0)
                };
                let files = changed
                    .into_iter()
                    .map(|(p, st)| BatchFile {
                        path: p.clone(),
                        stale: false,
                        reverted: false,
                        status: untrack_char(&st),
                        live: "same".into(),
                        edit_count: edit_count_of(&p),
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
                Some(if any_committed {
                    "已提交".into()
                } else {
                    "内容已变".into()
                }),
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
            engine: a.engine.clone(),
            model: a.model.clone(),
            thinking: a.thinking.clone(),
            state,
            done_reason,
            guard_id: stored.and_then(|s| s.guard_id.clone()),
            files,
            attribution: a.attribution.clone(),
        });
    }
    out.reverse(); // UI 倒序(最新在前)
    Ok(out)
}

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
    if dropped == 0 {
        // 条目没变仍可能需要清对象(历史遗留孤儿);不提前返回
    }
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
        // events open 批:edit 行自足前像 → live 现算
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
        // shell 落盘盲区:git 窗口推断补充路径,锚点基线 → live 与 git open 批同源
        if let Some(u) = user.as_ref() {
            let live = super::dirty_paths(u)?;
            let evented = super::events::evented_paths(&entries);
            let supp: Vec<String> =
                turn_changed_paths(&sidecar, Some(u), &root, a, &live, &entries)?
                    .into_iter()
                    .map(|(p, _)| p)
                    .filter(|p| !evented.contains(p))
                    .collect();
            if !supp.is_empty() {
                out.extend(super::open_batch_patches(cwd, &a.files, &supp)?);
            }
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

/// 封口批单文件 live 分类(对照账本固化的批后像):
/// 同容 → same(未动,可回退)| 已入 git → committed | 失配 → changed。
/// 非 git 工作区无 committed 档(提交状态不可推导)。
fn classify_turn_file(
    sidecar: &git2::Repository,
    root: &std::path::Path,
    tf: &TurnFile,
    live: &BTreeMap<String, String>,
    user: Option<&git2::Repository>,
) -> Result<String, CkptError> {
    let after = if tf.after_oid.is_empty() {
        None
    } else {
        let oid = git2::Oid::from_str(&tf.after_oid)?;
        Some(sidecar.find_blob(oid)?.content().to_vec())
    };
    let live_bytes = fs::read(root.join(&tf.path)).ok();
    if user.is_none() {
        // 非 git 工作区:提交态不可推导,只有 same(可回退/应用)/ changed 两档
        return Ok(if after.as_deref() == live_bytes.as_deref() {
            "same".into()
        } else {
            "changed".into()
        });
    }
    match (after, live_bytes) {
        (None, None) => Ok("committed".into()), // 批后已删,现在也没有 = 已处理
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
            Ok(if live.contains_key(&tf.path) {
                "changed".into()
            } else {
                "committed".into()
            })
        }
    }
}

fn untrack_char(status: &str) -> String {
    // untracked 在 live 状态里是 "?",批次文件展示沿用 A(新增)
    if status == "?" {
        "A".into()
    } else {
        status.to_string()
    }
}
