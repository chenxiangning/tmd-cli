//! 审批线账本 —— 快照存储域(账本模型,v2)。
//!
//! 职责边界:本模块只做账本**原语**(存 blob / 记账 / 求diff / 事务还原),
//! 不理解 CLI、不理解轮次语义;批次生命周期由前端事件(turnSettled/promptSent)
//! 驱动,经 commands 层落账。与 git 模块平级但语义不同:git = 用户仓库操作
//! (有 commit 安全不变量),checkpoints = 独立 sidecar 存储域,**永不触碰
//! 用户仓库的 index/refs**。
//! 存储布局:`{config_dir}/checkpoints/{md5(cwd)}/`
//!   objects.git   —— sidecar 裸仓库,只写 blob 对象(内容寻址去重),永不建 commit/ref
//!   ledger.jsonl  —— 账本(追加写;同一 id 多行时以最后一行为准 = turn 封口的修订)
//!   states.json   —— 批次审核态覆盖(persist 的只有 reverted;done 由 list 现场推导)
//!
//! 账本条目按 (工作区 cwd, sessionId, turn 轮次) 关联:
//!   anchor = 用户消息锚点(第 turn 轮开始前的工作区基线,不可变)
//!   turn   = 该轮封口后固化的变更集(逐文件 前后像 oid + unified diff,可修订至下一锚点)
//!   guard  = 回退前守卫(反悔恢复的依据,不可变)
//! list 只读账本渲染视图,不再做任何推导归因 —— 每轮绑定的文件集合在封口瞬间定死。

mod apply;
mod attribution;
mod batch_patches;
mod capture;
mod diff;
mod error;
mod events;
mod ledger;
mod patch;
mod path;
mod prune;
mod restore;
mod review;
mod store;
mod surgical;
mod turn_entry;
mod types;
mod view;

pub mod commands;
#[cfg(test)]
mod tests;

pub use apply::apply_batch;
pub use batch_patches::batch_patches;
pub use capture::{dirty_paths, snapshot_paths};
pub use diff::{blob_patch, open_batch_patches, CkptPatch};
pub use error::CkptError;
pub use events::record_edit;
pub(crate) use ledger::backfill_identity;
pub use ledger::{anchor_turn, seal_dead_turns, seal_turn};
pub use prune::prune;
pub use restore::{restore_batch, RestoreOutcome};
pub use review::{approve_batch, undo_revert};
pub use types::*;
pub use view::derive_batches;

pub(crate) use path::{canonicalize_event_path, is_external_path};
// store.rs 拆出后保持 super::* 引用契约(apply/events/ledger/restore/view 均经 super:: 取原语)。
#[cfg(test)]
pub use store::set_base_for_test;
pub(crate) use store::{
    append_ledger, load_ledger, load_states, lock_ledger, new_entry_id, now_millis, open_sidecar,
    open_user, rewrite_ledger, save_states, write_sidecar_blob, StatesFile,
};

/// 用户仓库 HEAD 中 path 的 blob 内容(基线兜底:anchor 时刻干净的文件,内容 == HEAD)。
/// repo = None(非 git 工作区)= 无兜底。
fn head_blob_bytes(
    repo: Option<&git2::Repository>,
    path: &str,
) -> Result<Option<Vec<u8>>, CkptError> {
    let Some(repo) = repo else { return Ok(None) };
    let Ok(head) = repo.head() else {
        return Ok(None); // unborn HEAD(空仓库)
    };
    let tree = match head.peel_to_tree() {
        Ok(t) => t,
        Err(_) => return Ok(None),
    };
    let Ok(entry) = tree.get_path(std::path::Path::new(path)) else {
        return Ok(None); // HEAD 无此路径 = 无基线
    };
    Ok(Some(repo.find_blob(entry.id())?.content().to_vec()))
}

/// 基线文件条目(anchor/guard 的 files)中 path 的内容解析:
/// 条目工作区 blob(sidecar)→ git 侧基线 blob(用户仓库,可能缺)→ None(不存在)。
/// 返回 (bytes, from_sidecar)。user = None(非 git 工作区)时只走 sidecar 副本。
pub(crate) fn resolve_snap_bytes(
    sidecar: &git2::Repository,
    user: Option<&git2::Repository>,
    files: &[SnapFile],
    path: &str,
) -> Result<Option<(Vec<u8>, bool)>, CkptError> {
    let Some(entry) = files.iter().find(|f| f.path == path) else {
        // 快照时刻干净的路径 = 当时内容即 HEAD(非 git 工作区无此兜底)
        return head_blob_bytes(user, path).map(|o| o.map(|b| (b, false)));
    };
    if !entry.oid.is_empty() {
        let oid = git2::Oid::from_str(&entry.oid)?;
        return Ok(Some((sidecar.find_blob(oid)?.content().to_vec(), true)));
    }
    if !entry.base_oid.is_empty() {
        if let Some(user) = user {
            let oid = git2::Oid::from_str(&entry.base_oid)?;
            return Ok(Some((user.find_blob(oid)?.content().to_vec(), false)));
        }
    }
    Ok(None) // existed=false 或 skip:该路径在快照时刻无内容
}

/// 账本去重折叠后的会话链:session_id 命中主键,或 tmd_session_id 命中副键
/// (首条锚点常落在 CLI 身份绑定之前,以 tmd id 记账;回填后统一)。
/// 副键无条件参与匹配:封口调用方的 CLI 身份可能漂移丢失(→ 主键 = tmd id),
/// 此时靠 tmd 副键找回自己的链;tmd id 会话级唯一,无误伤。
pub(crate) fn entry_in_session(e: &LedgerEntry, session_id: &str, tmd_session_id: &str) -> bool {
    if e.session_id == session_id {
        return true;
    }
    !tmd_session_id.is_empty() && e.tmd_session_id == tmd_session_id
}
