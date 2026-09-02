//! 批次推导 + live 分类 + 保留策略(从 mod.rs 按文件规模铁则拆出)。
//!
//! 批次 = 相邻 anchor 快照的路径差集;done 现场推导(提交/失配),不落盘;
//! reverted 从 states.json 读取。逐文件 live 分类需要读工作区比对 ——
//! list 按需调用(UI 打开/批次更新),勿挂高频轮询。

use super::{
    capture, load_manifests, load_states, manifests_file, now_millis, open_sidecar, open_user,
    resolve_snap_bytes, save_states, ws_dir, BatchFile, BatchInfo, CkptError, Snapshot,
};
use std::collections::BTreeMap;
use std::fs;

/// 批次推导(session 严格隔离)。审批线生命周期 = 单个 tmd 会话:
/// 只取该会话的锚点序列配对成批,其他会话/历史会话的锚点一律不可见。
/// sidecar 按 cwd 分库只是存储布局,可见性完全由 sessionId 划界。
pub fn derive_batches(cwd: &str, session_id: &str) -> Result<Vec<BatchInfo>, CkptError> {
    let manifests = load_manifests(cwd);
    let anchors: Vec<&Snapshot> = manifests
        .iter()
        .filter(|s| s.kind == "anchor" && s.session_id == session_id)
        .collect();
    let states = load_states(cwd);

    // 用户仓库侧:live dirty 集(open_user 同时验证 git 工作区前提)
    let user = open_user(cwd)?;
    let live = capture::dirty_paths(&user)?;

    let sidecar = open_sidecar(cwd)?;
    let root = std::path::PathBuf::from(cwd);
    {
        let mut out = Vec::new();
        for (i, a) in anchors.iter().enumerate() {
            let b = anchors.get(i + 1).copied();
            let open = b.is_none();
            let Some(paths) = batch_paths(a, b, open, &live) else {
                continue; // 封口后零差异 = 纯阅读轮,不进审批线
            };
            let stored = states.batches.get(&a.id).cloned().unwrap_or_default();
            // open 批在 CLI 尚未触碰文件时也是空的:同样不出现,等有改动再上时间线
            if paths.is_empty() {
                continue;
            }

            let mut files = Vec::new();
            let mut any_committed = false;
            let mut all_processed = !paths.is_empty();
            for (path, status) in paths {
                let reverted = stored.reverted_paths.iter().any(|p| p == &path);
                let live_state = if open || reverted {
                    if reverted { "reverted" } else { "same" }.to_string()
                } else {
                    classify_live(&sidecar, &user, &root, b.unwrap(), &path, &live)?
                };
                match live_state.as_str() {
                    "committed" => any_committed = true,
                    "same" => all_processed = false,
                    _ => {} // changed / reverted 都算已处理
                }
                files.push(BatchFile {
                    stale: live_state == "changed",
                    path,
                    status,
                    reverted,
                    live: live_state,
                });
            }

            let reverted = stored.state == "reverted";
            let approved = stored.state == "approved";
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
                index: 0,
                open,
                ts: a.ts,
                ts_end: b.map(|s| s.ts),
                session_id: a.session_id.clone(),
                prompt: a.prompt.clone(),
                state,
                done_reason,
                guard_id: stored.guard_id,
                files,
            });
        }
        out.reverse(); // UI 倒序(最新在前);index 仍按时间正序编
        let n = out.len();
        for (i, b) in out.iter_mut().enumerate() {
            b.index = n - i;
        }
        Ok(out)
    }
}

/// live 相对批后像(B)的分类:同容 → same(未动)|已入 git → committed|失配 → changed。
pub(super) fn classify_live(
    sidecar: &git2::Repository,
    user: &git2::Repository,
    root: &std::path::Path,
    b: &Snapshot,
    path: &str,
    live: &BTreeMap<String, String>,
) -> Result<String, CkptError> {
    let after = resolve_snap_bytes(sidecar, user, b, path)?;
    let live_bytes = fs::read(root.join(path)).ok();
    match (after, live_bytes) {
        (None, None) => Ok("committed".into()),  // 批后已删,现在也没有 = 已处理
        (None, Some(_)) => Ok("changed".into()), // 批后已删,现在又出现且非彼内容
        (Some(a), Some(l)) => {
            if a.0 != l {
                Ok("changed".into())
            } else if live.contains_key(path) {
                // 内容 == 批后像但仍是 dirty:自封口起没人动过 → 待审未动,可回退
                Ok("same".into())
            } else {
                // 干净且 == 批后像 = 已随提交进入 git(或被外部还原)
                Ok("committed".into())
            }
        }
        (Some(_), None) => {
            // 批后有内容,现在没了:不在 dirty 集 = 被 commit 后又 revert 掉,视为已处理;
            // 在 dirty 集 = 工作区删除,内容已变(不可回退恢复删除态)
            Ok(if live.contains_key(path) { "changed".into() } else { "committed".into() })
        }
    }
}

/// 单批路径集:sealed = A/B 两快照的路径差集(状态或内容变即入批);
/// open = live dirty − A 已记录路径(A 时已 dirty 的路径无法区分是否本轮再改,不重复归因)。
/// 返回 None = 封口后零差异(纯阅读轮)。
pub(super) fn batch_paths(
    a: &Snapshot,
    b: Option<&Snapshot>,
    open: bool,
    live: &BTreeMap<String, String>,
) -> Option<Vec<(String, String)>> {
    let mut paths: Vec<(String, String)> = Vec::new();
    if open {
        for p in live.keys() {
            if !a.files.iter().any(|f| &f.path == p) {
                let status = live.get(p).cloned().unwrap_or_else(|| "M".into());
                paths.push((p.clone(), untrack_char(&status)));
            }
        }
    } else {
        let bb = b.unwrap();
        let key = |s: &Snapshot, p: &str| -> Option<(String, bool)> {
            s.files
                .iter()
                .find(|f| f.path == p)
                .map(|f| (f.oid.clone(), f.existed))
        };
        let mut candidates = std::collections::BTreeSet::new();
        for f in &a.files {
            candidates.insert(f.path.clone());
        }
        for f in &bb.files {
            candidates.insert(f.path.clone());
        }
        for p in candidates {
            if key(a, &p) != key(bb, &p) {
                paths.push((p.clone(), status_char(a, Some(bb), &p)));
            }
        }
        if paths.is_empty() {
            return None;
        }
    }
    paths.sort();
    Some(paths)
}

fn untrack_char(status: &str) -> String {
    // untracked 在 live 状态里是 "?",批次文件展示沿用 A(新增)
    if status == "?" { "A".into() } else { status.to_string() }
}

/// 批次发生时的状态符:B 侧(批后)优先 —— 批内新建 → A,已删 → D,否则 M。
fn status_char(a: &Snapshot, b: Option<&Snapshot>, path: &str) -> String {
    let in_a = a.files.iter().find(|f| f.path == path);
    let in_b = b.and_then(|s| s.files.iter().find(|f| f.path == path));
    match (in_a.map(|f| f.existed), in_b.map(|f| f.existed)) {
        (_, Some(false)) => "D".into(),                        // 批后已删
        (Some(false), _) | (None, Some(true)) => "A".into(),   // 批前不存在 → 批内新建
        _ => "M".into(),
    }
}

/// prune:保最近 keep_per_cwd 个 anchor + TTL 内的 anchor;悬空 states/guard 一并清理。
/// sidecar 里的孤儿 blob 不回收(内容寻址 + 量小;不值得引入 gc)。
pub fn prune(cwd: &str, keep: usize, ttl_days: u32) -> Result<usize, CkptError> {
    let manifests = load_manifests(cwd);
    let ttl_ms = ttl_days as i64 * 86_400_000;
    let cutoff = now_millis() - ttl_ms;
    let anchors: Vec<&Snapshot> = manifests.iter().filter(|s| s.kind == "anchor").collect();
    let Some(keep_from) = anchors.len().checked_sub(keep) else {
        return Ok(0);
    };
    // 保留线 = 第 keep 新 anchor 的时间(与 TTL 取更晚者)
    let Some(line) = anchors.get(keep_from).map(|s| s.ts) else {
        return Ok(0);
    };
    let cutoff = cutoff.max(line);
    let kept_ids: std::collections::BTreeSet<String> = anchors
        .iter()
        .filter(|s| s.ts >= cutoff)
        .map(|s| s.id.clone())
        .collect();
    let dropped = anchors.len() - kept_ids.len();
    if dropped == 0 {
        return Ok(0);
    }

    let mut states = load_states(cwd);
    states.batches.retain(|id, _| kept_ids.contains(id));
    let guard_ids: std::collections::BTreeSet<String> = states
        .batches
        .values()
        .filter_map(|s| s.guard_id.clone())
        .collect();

    let file = manifests_file(cwd);
    let mut out = String::new();
    for m in &manifests {
        let keep_line = match m.kind.as_str() {
            "anchor" => kept_ids.contains(&m.id),
            "guard" => guard_ids.contains(&m.id),
            _ => false,
        };
        if keep_line {
            out.push_str(&serde_json::to_string(m).unwrap());
            out.push('\n');
        }
    }
    fs::create_dir_all(ws_dir(cwd))?;
    fs::write(&file, out)?;
    save_states(cwd, &states)?;
    Ok(dropped)
}

