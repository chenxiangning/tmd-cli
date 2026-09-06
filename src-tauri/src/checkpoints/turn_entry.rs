//! turn 条目构建 —— 自 ledger.rs 拆出(文件规模铁则)。
//! 锚点基线 + live 工作区 → 逐文件前后像 + diff 固化(身份恒继承锚点;
//! 双归因分支:events 见 events.rs,git 见 attribution.rs;审计冻结语义见 fn doc)。

use super::{now_millis, open_sidecar, open_user, CkptError, LedgerEntry, TurnFile};

/// 由锚点基线 + live 工作区构建 turn 条目(逐文件前后像 + diff 固化)。
/// 身份恒继承锚点:封口可能由任一事件触发,调用方身份在 CLI 绑定前后可能漂移
/// (cli id ↔ tmd id),随调用方会让同一锚点的链劈成两截。
///
/// 双归因:events 分支在 events.rs(build_events_turn_files),git 分支在下方。
///
/// 审计冻结:批一旦发生过回退/应用(审核态带 guard),固化的变更集即成历史
/// —— 修订重封不得按 live 重算把已退文件剔出批(2026-09-05 实证:9 文件批缩成
/// 1 文件)。但冻结期内(回退/应用后、下一锚点前)的手工改动也不允许凭空消失:
/// 修订 = live 重算 ∪ 被剔出的封印文件(回补原前后像)—— 已退文件保持封印,
/// 手改文件以新后像入修订,审计链不留洞。反悔清 guard 即解冻。
pub(super) fn build_turn_entry(
    cwd: &str,
    anchor: &LedgerEntry,
    entries: &[LedgerEntry],
) -> Result<Option<LedgerEntry>, CkptError> {
    let frozen = super::load_states(cwd)
        .batches
        .get(&anchor.id)
        .map(|s| s.guard_id.is_some())
        .unwrap_or(false);
    let sidecar = open_sidecar(cwd)?;
    let user = open_user(cwd).ok();
    let root = std::path::PathBuf::from(cwd);
    let prev = entries
        .iter()
        .rfind(|e| e.kind == "turn" && e.id == anchor.id);

    let mut turn_files = if anchor.attribution == "events" {
        super::events::build_events_turn_files(&sidecar, &root, anchor, entries)?
    } else {
        let Some(user) = user.as_ref() else {
            return Ok(None); // git 归因 + 非 git:无 dirty 集可推断
        };
        super::attribution::build_git_turn_files(&sidecar, user, &root, anchor, entries)?
    };
    if frozen {
        // 冻结批修订:live 重算剔出的封印文件(回退删除/还原的)按原前后像回补,
        // 留在重算结果里的文件(含冻结期手改)以新像入修订 —— 审计链不留洞
        if let Some(p) = prev {
            for tf in &p.turn_files {
                if !turn_files.iter().any(|t| t.path == tf.path) {
                    turn_files.push(tf.clone());
                }
            }
        }
    }
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
