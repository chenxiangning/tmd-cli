//! events 归因(AI 写入事件流)的记账与封口 —— ledger 的姊妹模块。
//!
//! 数据流:EditWatch(内核)命中 → checkpoint_record_edit → record_edit
//! 流式落 edit 行(每轮每文件一行,重复事件修订计数)→ 封口时
//! build_events_turn_files 把 edit 行固化成 TurnFile(前像 = 首击自足副本,
//! 后像 = 封口时刻磁盘)。git 归因(窗口推断)仍在 ledger.rs。
//!
//! 前像三级解析(首击时,全部拷进 sidecar 自足):
//! 1. anchor 基线(dirty 快照 / 用户仓库 HEAD 兜底);
//! 2. 同路径最近一条「仍在磁盘上」的 turn 批后像(回退感知:已退批跳过)——
//!    上一轮封口内容即本轮真实起点,非 git 工作区(anchor 基线恒空)靠它
//!    维持 M/D 语义,缺失它则既有文件会被误记 A、回退变成整文件删除;
//! 3. 都不可知 = 真新建(A)。

use super::{
    append_ledger, entry_in_session, load_ledger, lock_ledger, now_millis, open_sidecar, open_user,
    resolve_snap_bytes, write_sidecar_blob, CkptError, LedgerEntry, TurnFile,
};
use std::fs;

/// AI 写入事件流式记账(设计点:审批线跟随 AI 输出落盘,相当于账本)。
/// 事件到达即刻:定位本会话 open 轮锚点 → 该路径首击时抓批前像并拷成
/// sidecar 自足副本 + 磁盘首拍快照;重复事件修订计数不重抓。
/// 返回 false = 事件被丢弃(无锚点 / git 归因会话 / 该轮已封口后的回放)。
pub fn record_edit(
    cwd: &str,
    session_id: &str,
    tmd_session_id: &str,
    path: &str,
) -> Result<bool, CkptError> {
    // 路径纪律:仓库相对、拒绝绝对/父级逃逸(事件正则来自 CLI 输出,不可信)
    if path.is_empty()
        || path.starts_with('/')
        || std::path::Path::new(path)
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Ok(false);
    }
    let _g = lock_ledger();
    let entries = load_ledger(cwd);
    let Some(anchor) = entries
        .iter()
        .filter(|e| e.kind == "anchor" && entry_in_session(e, session_id, tmd_session_id))
        .max_by_key(|e| (e.turn, e.ts))
        .filter(|a| a.attribution == "events")
    else {
        return Ok(false);
    };
    // 该轮已封口:封口后的输出(回放/重绘/迟到的翻译行)不记账
    if entries
        .iter()
        .any(|e| e.kind == "turn" && e.id == anchor.id)
    {
        return Ok(false);
    }

    let sidecar = open_sidecar(cwd)?;
    let user = open_user(cwd).ok();
    let ts = now_millis();

    let prev = entries
        .iter()
        .rfind(|e| e.kind == "edit" && e.id == anchor.id && e.path == path)
        .cloned();
    let entry = match prev {
        Some(mut p) => {
            p.seal_ts = ts; // 末次事件时刻
            p.edit_count += 1;
            p
        }
        None => {
            // 首击:批前像三级解析(见模块 doc)→ 立即拷进 sidecar 自足副本
            // (用户仓库之后 gc/重置不影响账本);首拍 = 此刻磁盘内容快照。
            let mut before = resolve_snap_bytes(&sidecar, user.as_ref(), &anchor.files, path)?;
            if before.is_none() {
                let states = super::load_states(cwd);
                before = latest_turn_after(&sidecar, &entries, &states, path)?;
            }
            let before_oid = before
                .map(|(b, _)| write_sidecar_blob(&sidecar, &b))
                .transpose()?
                .unwrap_or_default();
            let snap_oid = fs::read(std::path::Path::new(cwd).join(path))
                .ok()
                .map(|b| write_sidecar_blob(&sidecar, &b))
                .transpose()?
                .unwrap_or_default();
            LedgerEntry {
                id: anchor.id.clone(),
                kind: "edit".into(),
                ts,
                session_id: anchor.session_id.clone(),
                tmd_session_id: anchor.tmd_session_id.clone(),
                turn: anchor.turn,
                seal_ts: ts,
                attribution: "events".into(),
                path: path.to_string(),
                before_oid,
                snap_oid,
                edit_count: 1,
                ..Default::default()
            }
        }
    };
    append_ledger(cwd, &entry)?;
    Ok(true)
}

/// 跨轮前像链:倒序找同路径最近一条「仍在磁盘上」的 turn 记录,其批后像即本轮起点。
/// 回退感知:states 里已退批(reverted_paths 含该路径)的后像不在磁盘上,
/// 跳过继续向老找 —— 回退后的再开轮,前像是被退回的内容而非批后像;
/// 命中的轮把文件删了(after 空/skip)= 更早内容不再算数,返回 None(真新建)。
fn latest_turn_after(
    sidecar: &git2::Repository,
    entries: &[LedgerEntry],
    states: &super::StatesFile,
    path: &str,
) -> Result<Option<(Vec<u8>, bool)>, CkptError> {
    let oid = entries
        .iter()
        .rev()
        .filter(|e| e.kind == "turn")
        .find_map(|t| {
            let tf = t.turn_files.iter().find(|tf| tf.path == path)?;
            // 该批此路径已被回退:后像不在磁盘,继续向老链
            let reverted = states
                .batches
                .get(&t.id)
                .map(|s| s.reverted_paths.iter().any(|p| p == path))
                .unwrap_or(false);
            (!reverted).then_some(tf.after_oid.as_str())
        })
        .filter(|oid| !oid.is_empty());
    let Some(oid) = oid else {
        return Ok(None);
    };
    let oid = git2::Oid::from_str(oid)?;
    Ok(Some((sidecar.find_blob(oid)?.content().to_vec(), true)))
}

/// events 归因的 open 轮文件集(视图共用):本轮 edit 行 → live 状态符。
/// live 存在 → A(前像空)/M(前像有);磁盘已无 → D。
pub(super) fn edit_open_paths(
    root: &std::path::Path,
    anchor: &LedgerEntry,
    entries: &[LedgerEntry],
) -> Result<Vec<(String, String)>, CkptError> {
    let mut out = Vec::new();
    for e in entries
        .iter()
        .filter(|e| e.kind == "edit" && e.id == anchor.id)
    {
        let status = if fs::read(root.join(&e.path)).is_err() {
            "D".to_string()
        } else if e.before_oid.is_empty() {
            "A".to_string()
        } else {
            // 前像自足副本在而磁盘内容等值 = 写了又写回;仍列出(轮未封口,轨迹可见)
            "M".to_string()
        };
        out.push((e.path.clone(), status));
    }
    Ok(out)
}

/// events 归因封口:本轮 edit 行 → TurnFile(前像 = 首击自足副本,
/// 后像 = 封口时刻磁盘;净零变更不入批,轨迹留在 edit 行)。
pub(super) fn build_events_turn_files(
    sidecar: &git2::Repository,
    root: &std::path::Path,
    anchor: &LedgerEntry,
    entries: &[LedgerEntry],
) -> Result<Vec<TurnFile>, CkptError> {
    let mut tfs = Vec::new();
    for e in entries
        .iter()
        .filter(|e| e.kind == "edit" && e.id == anchor.id)
    {
        let path = e.path.as_str();
        // 批前像 = edit 首击自足副本(anchor 基线含超大/冲突 skip 时为空)
        let before: Option<Vec<u8>> = if e.before_oid.is_empty() {
            None
        } else {
            let oid = git2::Oid::from_str(&e.before_oid)?;
            Some(sidecar.find_blob(oid)?.content().to_vec())
        };
        let anchor_skip = anchor
            .files
            .iter()
            .find(|f| f.path == path)
            .and_then(|f| f.skip.clone());

        // 批后像 = 封口时刻磁盘(超大/符号链接照旧 skip 只记状态)
        let full = root.join(path);
        let (after, existed_after, after_skip) = match std::fs::symlink_metadata(&full) {
            Err(_) => (None, false, None),
            Ok(meta) if meta.is_symlink() => (None, true, Some("符号链接".into())),
            Ok(meta) if meta.len() > super::MAX_FILE_BYTES => (
                None,
                true,
                Some(format!("超过 {}MiB", super::MAX_FILE_BYTES / 1024 / 1024)),
            ),
            Ok(_) => match fs::read(&full) {
                Ok(b) => (Some(b), true, None),
                Err(err) => (None, true, Some(format!("读取失败: {err}"))),
            },
        };
        if before.as_deref() == after.as_deref() {
            continue; // 写了又写回原样:无净变更不入批(轨迹留在 edit 行)
        }
        let existed_before = before.is_some();
        let status = match (existed_before, existed_after) {
            (false, true) => "A",
            (true, false) => "D",
            _ => "M",
        };
        let skip = anchor_skip.or(after_skip);
        let patch = if skip.is_some() {
            super::ledger::empty_patch(path, status)
        } else {
            super::blob_patch(sidecar, path, before.as_deref(), after.as_deref())?
        };
        let after_oid = match &after {
            Some(bytes) if skip.is_none() => write_sidecar_blob(sidecar, bytes)?,
            _ => String::new(),
        };
        tfs.push(TurnFile {
            path: path.to_string(),
            status: status.into(),
            before_oid: e.before_oid.clone(),
            after_oid,
            existed_before,
            existed_after,
            additions: patch.additions,
            deletions: patch.deletions,
            binary: patch.binary,
            patch: patch.patch,
            skip,
            edit_count: e.edit_count,
        });
    }
    Ok(tfs)
}
