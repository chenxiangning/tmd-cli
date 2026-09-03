//! 账本操作 —— 记账(anchor/edit)与封口(seal);视图(list)/保留策略(prune)在 view。
//!
//! 核心不变量:**归因在封口瞬间定死,list 只读账本**。
//! 每条 anchor 记第 N 轮开始前的工作区基线;seal 把「基线 → 当前工作区」的
//! 逐文件变更(前后像 blob + unified diff)固化成 turn 条目,追加进 ledger.jsonl
//! (同一 id 可修订追加,读取取最后一行)。
//!
//! 双归因(设计点「审批线跟随 AI 输出落盘」):
//! - events:AI 写入事件流(record_edit 流式记账)是归因主信号 —— 本轮碰过
//!   哪些文件由事件行定死;首击时抓前像拷成 sidecar 自足副本。
//! - git:未声明写入事件检测的 CLI 走窗口推断(attribution.rs)—— 窗口内
//!   dirty 推断 + mtime 落窗仲裁、最近提示者赢。
//! - events 会话的 shell 落盘(cp/脚本/重定向,无事件)是事件源盲区:open 视图
//!   与封口在 edit 行之外用同一套窗口推断补「全账本无 edit 行」的路径(事件
//!   路径永不被并行窗口抢走);非 git 工作区维持纯事件语义。
//!
//! 归因模式随锚点固化(anchor.attribution),封口/视图按锚点分支。
//!
//! 会话身份:锚点常发生在 CLI 磁盘身份绑定之前,先以 tmd 会话 id 记账;
//! 绑定后(anchor/seal 时)把同名 tmd id 的历史条目回填为 CLI id,
//! 查询按 (session_id, tmd_session_id) 双字段命中,单次查询即可取全链。

use super::{
    append_ledger, entry_in_session, load_ledger, new_entry_id, now_millis, open_sidecar,
    open_user, rewrite_ledger, CkptError, LedgerEntry, TurnFile,
};

/// 记第 N 轮锚点。隐式先封上一轮(防 turnSettled 丢失导致窗口跨轮),
/// 再做身份回填,最后抓基线落账。返回新锚点条目(含分配的轮次)。
/// engine/model/thinking = 发送时刻的引擎与状态快照,随锚点固化(历史批不随后续切换漂移)。
/// attribution = 归因模式("events" | "git"),由前端按 CLI profile 是否声明
/// 写入事件检测(editMarks)决定,随锚点定死。
#[allow(clippy::too_many_arguments)] // 与 checkpoint_anchor 同构:扁平参数直通 tauri IPC 契约
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
    seal_stale_foreign(cwd, &mut entries, STALE_OPEN_MS)?;

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
    entries: &mut [LedgerEntry],
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

/// 幽灵窗口收口:锚点超过 grace_ms 仍无 turn 条目(app 崩溃/强退 kill 掉
/// sessionExited,最后一轮永远等不到显式封口)时,代其封口 —— 开放窗口
/// 不再无限吞掉后续写入的归属,死链的最后一轮得以及时落账。
/// 返回本次代封的锚点数。幂等:已有 turn 条目的锚点不再处理。
/// 宽限语义:seal 对在途轮是修订追加(结算后再封只是多一行修订),误封
/// 活会话的在途轮无数据损失,只影响「进行中 → 待审」的提前切换 —— 因此
/// 记账路径(30min)与启动恢复路径(grace 0/60s)都可以放心收紧。
const STALE_OPEN_MS: i64 = 30 * 60 * 1000;

fn seal_stale_foreign(
    cwd: &str,
    entries: &mut Vec<LedgerEntry>,
    grace_ms: i64,
) -> Result<usize, CkptError> {
    let now = now_millis();
    let stale: Vec<LedgerEntry> = entries
        .iter()
        .filter(|e| {
            e.kind == "anchor"
                && now - e.ts > grace_ms
                && !entries.iter().any(|t| t.kind == "turn" && t.id == e.id)
        })
        .cloned()
        .collect();
    let mut sealed = 0;
    for a in &stale {
        // 单条失败不阻断记账主流程(如某外会话工作区已被删除)
        if let Ok(Some(t)) = build_turn_entry(cwd, a, entries) {
            append_ledger(cwd, &t)?;
            entries.push(t);
            sealed += 1;
        }
    }
    Ok(sealed)
}

/// 死锚点收口的显式入口(app 重启后由前端触发一次):上一运行的会话被
/// 强退杀掉,sessionExited 兜底封口没机会执行,其最后一段轮次在账本里
/// 仍是开放锚点。启动恢复 = 此刻无在途轮,grace 取 0 把全部死锚点立即
/// 落账。返回本次封口的锚点数。
pub fn seal_dead_turns(cwd: &str, grace_ms: i64) -> Result<usize, CkptError> {
    let _g = super::lock_ledger();
    let mut entries = load_ledger(cwd);
    seal_stale_foreign(cwd, &mut entries, grace_ms)
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
        .rfind(|e| e.kind == "turn" && e.id == anchor.id);

    let turn_files = if anchor.attribution == "events" {
        super::events::build_events_turn_files(&sidecar, user.as_ref(), &root, anchor, entries)?
    } else {
        let Some(user) = user.as_ref() else {
            return Ok(None); // git 归因 + 非 git:无 dirty 集可推断
        };
        super::attribution::build_git_turn_files(&sidecar, user, &root, anchor, entries)?
    };
    if turn_files.is_empty() {
        // events 归因:写过但净零(写了又写回)也要封口 —— 落一个空 turn 行
        // 把该轮关上(不再被视图当 open);纯阅读轮(无 edit 行)照旧不落账。
        if anchor.attribution == "events"
            && entries
                .iter()
                .any(|e| e.kind == "edit" && e.id == anchor.id)
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
