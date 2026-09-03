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

mod capture;
mod diff;
mod error;
mod ledger;
mod restore;
mod view;

pub mod commands;
#[cfg(test)]
mod tests;

pub use capture::{dirty_paths, snapshot_files};
pub use diff::{blob_patch, open_batch_patches, CkptPatch};
pub use error::CkptError;
pub use ledger::{anchor_turn, seal_turn};
pub use restore::{approve_batch, restore_batch, undo_revert, RestoreOutcome};
pub use view::{batch_patches, derive_batches, prune};

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

/// 单文件快照上限(对齐 OpenCode 经验值):超过则跳过存内容,只记状态。
pub const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

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
}

/// 账本条目。同一 id 可追加多行(turn 封口修订),读取以最后一行为准。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LedgerEntry {
    pub id: String,
    /// "anchor" | "turn" | "guard"
    pub kind: String,
    /// ms epoch(anchor/turn = 锚点时刻;guard = 回退时刻)
    pub ts: i64,
    /// 会话身份:写入时刻的规范 id(已绑 CLI 身份则 = CLI id,否则 = tmd 会话 id)
    pub session_id: String,
    /// tmd 会话 id(恒填;CLI 身份回填/查询副键)
    #[serde(default)]
    pub tmd_session_id: String,
    /// 1-based 会话内轮次(anchor/turn 条目;guard = 0)
    #[serde(default)]
    pub turn: u64,
    /// 锚点 prompt 摘要(anchor/turn 条目)
    #[serde(default)]
    pub prompt: String,
    /// turn 封口时刻(ms;修订追加时刷新)
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

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StatesFile {
    #[serde(default)]
    pub batches: BTreeMap<String, BatchState>,
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
    /// pending | reverted | done(现场推导)
    pub state: String,
    pub done_reason: Option<String>,
    pub guard_id: Option<String>,
    pub files: Vec<BatchFile>,
}

/// 账本互斥:anchor/seal/restore/prune 都要读改 ledger.jsonl,
/// 进程内串行化防并行会话同时落账交错(文件自身是追加写,跨进程天然安全)。
pub(crate) static LEDGER_LOCK: Mutex<()> = Mutex::new(());

/// 持有 LEDGER_LOCK 的 RAII 守卫(测试 panic 毒化后可恢复)。
pub(crate) fn lock_ledger() -> std::sync::MutexGuard<'static, ()> {
    LEDGER_LOCK.lock().unwrap_or_else(|p| p.into_inner())
}

static SEQ: AtomicU64 = AtomicU64::new(0);

#[cfg(test)]
static TEST_BASE: std::sync::RwLock<Option<PathBuf>> = std::sync::RwLock::new(None);

/// 存储根。测试经 set_base_for_test 重定向,生产 = ~/.tmd-cli/checkpoints。
fn base_dir() -> PathBuf {
    #[cfg(test)]
    if let Some(p) = TEST_BASE.read().unwrap().clone() {
        return p;
    }
    crate::session::config_dir().join("checkpoints")
}

#[cfg(test)]
pub fn set_base_for_test(p: PathBuf) {
    *TEST_BASE.write().unwrap() = Some(p);
}

fn ws_dir(cwd: &str) -> PathBuf {
    base_dir().join(crate::hash::md5_hex(cwd.to_string()))
}

#[cfg(test)]
pub(crate) fn ledger_file(cwd: &str) -> PathBuf {
    ws_dir(cwd).join("ledger.jsonl")
}

#[cfg(not(test))]
fn ledger_file(cwd: &str) -> PathBuf {
    ws_dir(cwd).join("ledger.jsonl")
}

fn states_file(cwd: &str) -> PathBuf {
    ws_dir(cwd).join("states.json")
}

/// 打开(必要时初始化)sidecar 裸仓库。只作 blob 对象库使用。
fn open_sidecar(cwd: &str) -> Result<git2::Repository, CkptError> {
    let dir = ws_dir(cwd).join("objects.git");
    if dir.join("HEAD").exists() {
        return Ok(git2::Repository::open(&dir)?);
    }
    fs::create_dir_all(&dir)?;
    let mut opts = git2::RepositoryInitOptions::new();
    opts.bare(true).mkpath(true);
    Ok(git2::Repository::init_opts(&dir, &opts)?)
}

/// 打开用户仓库(discover 向上找 .git)。不借 git::with_repo 的句柄缓存:
/// checkpoints 是按需低频调用,独立存储域自带错误语义更干净。
fn open_user(cwd: &str) -> Result<git2::Repository, CkptError> {
    match git2::Repository::discover(cwd) {
        Ok(r) => Ok(r),
        Err(e) if e.code() == git2::ErrorCode::NotFound => Err(CkptError::NotARepo(cwd.into())),
        Err(e) => Err(e.into()),
    }
}

/// 写 blob 进 sidecar(内容寻址,重复内容自动去重)。
pub(crate) fn write_sidecar_blob(repo: &git2::Repository, data: &[u8]) -> Result<String, CkptError> {
    let odb = repo.odb()?;
    let oid = odb.write(git2::ObjectType::Blob, data)?;
    Ok(oid.to_string())
}

pub(crate) fn append_ledger(cwd: &str, entry: &LedgerEntry) -> Result<(), CkptError> {
    let file = ledger_file(cwd);
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    use std::io::Write;
    let mut f = fs::OpenOptions::new().create(true).append(true).open(&file)?;
    f.write_all(serde_json::to_string(entry).unwrap().as_bytes())?;
    f.write_all(b"\n")?;
    Ok(())
}

/// 读账本并折叠:同一 (kind, id) 多行以最后一行为准(turn 封口修订语义;
/// anchor 与 turn 共用 id 但 kind 不同,各自保留),保持文件顺序。
pub(crate) fn load_ledger(cwd: &str) -> Vec<LedgerEntry> {
    let Ok(content) = fs::read_to_string(ledger_file(cwd)) else {
        return Vec::new();
    };
    let mut latest: BTreeMap<String, LedgerEntry> = BTreeMap::new();
    let mut order: Vec<String> = Vec::new();
    for line in content.lines() {
        let Ok(e) = serde_json::from_str::<LedgerEntry>(line) else {
            continue;
        };
        let key = format!("{}:{}", e.kind, e.id);
        if !latest.contains_key(&key) {
            order.push(key.clone());
        }
        latest.insert(key, e);
    }
    order
        .into_iter()
        .filter_map(|key| latest.remove(&key))
        .collect()
}

/// 整文件重写账本(身份回填/ prune 用;条目顺序保持)。
pub(crate) fn rewrite_ledger(cwd: &str, entries: &[LedgerEntry]) -> Result<(), CkptError> {
    let file = ledger_file(cwd);
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut out = String::new();
    for e in entries {
        out.push_str(&serde_json::to_string(e).unwrap());
        out.push('\n');
    }
    fs::write(&file, out)?;
    Ok(())
}

fn load_states(cwd: &str) -> StatesFile {
    fs::read_to_string(states_file(cwd))
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

fn save_states(cwd: &str, states: &StatesFile) -> Result<(), CkptError> {
    let file = states_file(cwd);
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string(states).map_err(|e| CkptError::Store(e.to_string()))?;
    fs::write(&file, json)?;
    Ok(())
}

fn new_entry_id(ts: i64) -> String {
    format!("s{ts}-{}", SEQ.fetch_add(1, Ordering::SeqCst))
}

pub(crate) fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 用户仓库 HEAD 中 path 的 blob 内容(基线兜底:anchor 时刻干净的文件,内容 == HEAD)。
fn head_blob_bytes(repo: &git2::Repository, path: &str) -> Result<Option<Vec<u8>>, CkptError> {
    let Ok(head) = repo.head() else {
        return Ok(None); // unborn HEAD(空仓库)
    };
    let tree = match head.peel_to_tree() {
        Ok(t) => t,
        Err(_) => return Ok(None),
    };
    let Ok(entry) = tree.get_path(std::path::Path::new(path)) else {
        return Ok(None);
    };
    Ok(Some(repo.find_blob(entry.id())?.content().to_vec()))
}

/// 基线文件条目(anchor/guard 的 files)中 path 的内容解析:
/// 条目工作区 blob(sidecar)→ git 侧基线 blob(用户仓库)→ None(不存在)。
/// 返回 (bytes, from_sidecar)。
pub(crate) fn resolve_snap_bytes(
    sidecar: &git2::Repository,
    user: &git2::Repository,
    files: &[SnapFile],
    path: &str,
) -> Result<Option<(Vec<u8>, bool)>, CkptError> {
    let Some(entry) = files.iter().find(|f| f.path == path) else {
        // 快照时刻干净的路径 = 当时内容即 HEAD
        return head_blob_bytes(user, path).map(|o| o.map(|b| (b, false)));
    };
    if !entry.oid.is_empty() {
        let oid = git2::Oid::from_str(&entry.oid)?;
        return Ok(Some((sidecar.find_blob(oid)?.content().to_vec(), true)));
    }
    if !entry.base_oid.is_empty() {
        let oid = git2::Oid::from_str(&entry.base_oid)?;
        return Ok(Some((user.find_blob(oid)?.content().to_vec(), false)));
    }
    Ok(None) // existed=false 或 skip:该路径在快照时刻无内容
}

/// 账本去重折叠后的会话链:session_id 命中主键,或 tmd_session_id 命中副键
/// (首条锚点常落在 CLI 身份绑定之前,以 tmd id 记账;回填后统一)。
pub(crate) fn entry_in_session(e: &LedgerEntry, session_id: &str, tmd_session_id: &str) -> bool {
    if e.session_id == session_id {
        return true;
    }
    !tmd_session_id.is_empty() && tmd_session_id != session_id && e.tmd_session_id == tmd_session_id
}
