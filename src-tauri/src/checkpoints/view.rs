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
    entry_in_session, load_ledger, load_states, open_sidecar, open_user, BatchFile, BatchInfo,
    CkptError, LedgerEntry, TurnFile,
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
                    edit_open_paths(&root, a, &entries)
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
