//! 审批线账本 —— 快照存储域(账本模型,v2)。
//!
//! 职责边界:本模块只做账本**原语**(存 blob / 记账 / 求diff / 事务还原),
//! 不理解 CLI、不理解轮次语义;批次生命周期由前端事件(turnSettled/promptSent)
//! 驱动,经 commands 层落账。与 git 模块平级但语义不同:git = 用户仓库操作
//! (有 commit 安全不变量),checkpoints = 独立 sidecar 存储域,**永不触碰
//! 用户仓库的 index/refs**。
//!
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
mod prune;
mod restore;
mod review;
mod store;
mod turn_entry;
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
pub use ledger::{anchor_turn, seal_dead_turns, seal_turn};
pub use prune::prune;
pub use restore::{restore_batch, RestoreOutcome};
pub use review::{approve_batch, undo_revert};
pub use view::derive_batches;

use serde::{Deserialize, Serialize};

/// 单文件快照上限:超过则跳过存内容,只记状态(副本完整性 tradeoff:
/// 覆盖常规源码/配置,避免巨型产物撑爆 sidecar;skip 语义在 UI 显式可见)。
pub const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;

/// anchor 时刻(或 guard 时刻)的单文件记录。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SnapFile {
    /// 相对用户仓库 root 的路径(lossy UTF-8,与 git 模块同惯例)
    pub path: String,
    /// 工作区内容在 sidecar 的 blob hex;"" = 未存(existed=false 或 skip)
    pub oid: String,
    /// git 侧(index)内容 blob hex(用户仓库对象);"" = untracked 无基线。
    /// 前像兜底:恢复/求 diff 时 oid 为空则落到此处。
    #[serde(default)]
    pub base_oid: String,
    /// 快照时刻工作区是否存在该文件(false = 已删;恢复到此快照 = 删除)
    pub existed: bool,
    pub bytes: u64,
    /// 跳过存内容的原因(symlink / 过大 / 冲突 / 读失败)
    #[serde(default)]
    pub skip: Option<String>,
    /// 快照时刻的 git 展示状态符(A/M/D/R/T/C/?)
    pub status: String,
}

/// turn 封口条目里的单文件变更记录 —— 账本的核心:前后像 + diff 固化。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct TurnFile {
    pub path: String,
    /// A(轮内新建)| D(轮内删除)| M
    pub status: String,
    /// 批前像 blob(sidecar);"" = 批前无内容(新建)
    pub before_oid: String,
    /// 批后像 blob(sidecar);"" = 批后无内容(删除)或内容不可知(skip)
    pub after_oid: String,
    pub existed_before: bool,
    pub existed_after: bool,
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
    /// unified diff 文本(封口瞬间固化);binary 为空串
    #[serde(default)]
    pub patch: String,
    /// 批前/后像不可存档的原因(继承自 anchor 的 skip:超大/符号链接/冲突)
    #[serde(default)]
    pub skip: Option<String>,
    /// 本轮 AI 写入事件计数(events 归因;git 归因 = 0)
    #[serde(default)]
    pub edit_count: u32,
}

/// 账本条目。同一 id 可追加多行(turn 封口修订),读取以最后一行为准。
/// edit 行按 (kind, id, path) 折叠 —— 每轮每文件一行,重复事件修订计数。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LedgerEntry {
    pub id: String,
    /// "anchor" | "turn" | "guard" | "edit"
    pub kind: String,
    /// ms epoch(anchor/turn/edit = 锚点时刻或事件首击;guard = 回退时刻)
    pub ts: i64,
    /// 会话身份:写入时刻的规范 id(已绑 CLI 身份则 = CLI id,否则 = tmd 会话 id)
    pub session_id: String,
    /// tmd 会话 id(恒填;CLI 身份回填/查询副键)
    #[serde(default)]
    pub tmd_session_id: String,
    /// 1-based 会话内轮次(anchor/turn/edit 条目;guard = 0)
    #[serde(default)]
    pub turn: u64,
    /// 锚点 prompt 摘要(anchor/turn 条目)
    #[serde(default)]
    pub prompt: String,
    /// 锚点时刻快照:引擎显示名 / 模型 / 思考强度(空串 = 未知;旧账本条目缺省为空)
    #[serde(default)]
    pub engine: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub thinking: String,
    /// turn 封口时刻(ms;修订追加时刷新);edit 行复用为末次事件时刻
    #[serde(default)]
    pub seal_ts: i64,
    /// guard 所属批次 id
    #[serde(default)]
    pub batch_id: String,
    /// anchor/guard 条目:时刻工作区基线
    #[serde(default)]
    pub files: Vec<SnapFile>,
    /// turn 条目:固化变更集
    #[serde(default)]
    pub turn_files: Vec<TurnFile>,
    /// 归因模式,随锚点固化:"events"(AI 写入事件流,设计点「跟随 AI 输出」)
    /// | "git"(窗口内 git status 推断,未声明 editMarks 的 CLI 回退)。
    /// 旧账本条目缺省 = "git"(当时的唯一模式)。
    #[serde(default)]
    pub attribution: String,
    /// edit 行专用:事件目标路径(仓库相对)
    #[serde(default)]
    pub path: String,
    /// edit 行专用:轮内首击时抓的批前像(sidecar blob,自足副本 —— 不依赖
    /// 用户 git 对象存活;anchor 基线解析不到 = 空串,seal 时按无前像处理)
    #[serde(default)]
    pub before_oid: String,
    /// edit 行专用:首击时刻的磁盘内容快照(sidecar blob;轮内中间态的
    /// 账本轨迹,审计可见,不参与回退语义)
    #[serde(default)]
    pub snap_oid: String,
    /// edit 行专用:本轮该文件的 AI 写入事件计数
    #[serde(default)]
    pub edit_count: u32,
}

/// 批次审核态(persist 覆盖项)。done 不落盘 —— 由 list 现场推导(提交/失配)。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct BatchState {
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub guard_id: Option<String>,
    #[serde(default)]
    pub reverted_paths: Vec<String>,
}

/// list 推导出的批次文件(含 live 分类,UI 直接消费)。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BatchFile {
    pub path: String,
    /// 批次发生时的 git 状态符(A/M/D)
    pub status: String,
    /// 已被单文件/整批回退
    pub reverted: bool,
    /// live 相对批后像:same(未动,可回退)| changed(内容已变)| committed(已入 git)
    pub live: String,
    /// live == "changed" 的便捷标记(不可回退,仅可对照)
    pub stale: bool,
    /// 本轮 AI 写入事件计数(events 归因的轨迹;git 归因 = 0)
    pub edit_count: u32,
}

/// list 推导出的批次。id = 起始 anchor 的条目 id(稳定);index = 账本轮次。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BatchInfo {
    pub id: String,
    /// 会话内 1-based 轮次(账本记录;纯阅读轮缺号 = 真实轮次)
    pub index: u64,
    /// true = 尚未封口(最后一个 anchor 之后)
    pub open: bool,
    pub ts: i64,
    pub ts_end: Option<i64>,
    pub session_id: String,
    pub prompt: String,
    /// 锚点时刻快照:引擎显示名 / 模型 / 思考强度(继承锚点条目)
    pub engine: String,
    pub model: String,
    pub thinking: String,
    /// pending | reverted | done(现场推导)
    pub state: String,
    pub done_reason: Option<String>,
    pub guard_id: Option<String>,
    pub files: Vec<BatchFile>,
    /// 归因模式:"events"(AI 事件流)| "git"(推断;UI 提示可信度)
    pub attribution: String,
}

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
