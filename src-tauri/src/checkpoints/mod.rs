//! 批次审批/回退 —— 快照存储域(spec: docs/superpowers/specs/2026-09-02-checkpoints-batch-review-design.md)。
//!
//! 职责边界:本模块只做快照**原语**(存 blob / 推导批次 / 求diff / 事务还原),
//! 不理解 CLI、不理解轮次;批次状态机与 UI 在前端 checkpoints 插件。
//! 与 git 模块平级但语义不同:git = 用户仓库操作(有 commit 安全不变量),
//! checkpoints = 独立 sidecar 存储域,**永不触碰用户仓库的 index/refs**。
//!
//! 存储布局:`{config_dir}/checkpoints/{md5(cwd)}/`
//!   objects.git     —— sidecar 裸仓库,只写 blob 对象(内容寻址去重),永不建 commit/ref
//!   manifests.jsonl —— 快照清单(每行一个 Snapshot,追加写)
//!   states.json     —— 批次审核态覆盖(persist 的只有 reverted;done 由 list 现场推导)
//!
//! 批次 = 相邻两个 anchor 快照的路径差集(快照与归因解耦,不解析 CLI 工具流)。
//! 快照成本 = O(变动集):anchor 时刻 dirty 的路径才存工作区 blob;
//! 干净文件的前像永远可从 git 侧(index/HEAD blob)兜底推导。

mod capture;
mod diff;
mod error;
mod restore;

pub mod commands;
#[cfg(test)]
mod tests;

pub use capture::capture_snapshot;
pub use diff::batch_patches;
pub use error::CkptError;
pub use restore::{restore_batch, undo_revert, RestoreOutcome};

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

/// 单文件快照上限(对齐 OpenCode 经验值):超过则跳过存内容,只记状态。
pub const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// anchor 时刻的单文件记录。
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
    /// anchor 时刻工作区是否存在该文件(false = 已删;恢复到此快照 = 删除)
    pub existed: bool,
    pub bytes: u64,
    /// 跳过存内容的原因(symlink / 过大 / 冲突 / 读失败)
    #[serde(default)]
    pub skip: Option<String>,
    /// anchor 时刻的 git 展示状态符(A/M/D/R/T)
    pub status: String,
}

/// 一份快照(anchor = 用户消息锚点;guard = 回退前自动守卫)。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    /// ms epoch
    pub ts: i64,
    /// "anchor" | "guard"
    pub kind: String,
    pub session_id: String,
    /// 锚点 prompt 摘要(截断存储;全文归前端锚点栏设施)
    pub prompt: String,
    pub files: Vec<SnapFile>,
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

/// 推导出的批次。id = 起始 anchor 的快照 id(稳定)。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BatchInfo {
    pub id: String,
    /// 1-based 显示序号(老 → 新;prune 后会重排,展示语义)
    pub index: usize,
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

fn manifests_file(cwd: &str) -> PathBuf {
    ws_dir(cwd).join("manifests.jsonl")
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
fn write_sidecar_blob(repo: &git2::Repository, data: &[u8]) -> Result<String, CkptError> {
    let odb = repo.odb()?;
    let oid = odb.write(git2::ObjectType::Blob, data)?;
    Ok(oid.to_string())
}

fn append_manifest(cwd: &str, snap: &Snapshot) -> Result<(), CkptError> {
    let file = manifests_file(cwd);
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    use std::io::Write;
    let mut f = fs::OpenOptions::new().create(true).append(true).open(&file)?;
    f.write_all(serde_json::to_string(snap).unwrap().as_bytes())?;
    f.write_all(b"\n")?;
    Ok(())
}

fn load_manifests(cwd: &str) -> Vec<Snapshot> {
    let Ok(content) = fs::read_to_string(manifests_file(cwd)) else {
        return Vec::new();
    };
    content
        .lines()
        .filter_map(|l| serde_json::from_str::<Snapshot>(l).ok())
        .collect()
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

fn new_snapshot_id(ts: i64) -> String {
    format!("s{ts}-{}", SEQ.fetch_add(1, Ordering::SeqCst))
}

/// 用户仓库 HEAD 中 path 的 blob 内容(前像兜底:anchor 时刻干净的文件,内容 == HEAD)。
fn head_blob_bytes<'r>(repo: &'r git2::Repository, path: &str) -> Result<Option<Vec<u8>>, CkptError> {
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

/// 快照文件条目的内容解析:工作区 blob(sidecar)→ git 侧基线 blob(用户仓库)→ None(不存在)。
/// 返回 (bytes, from_sidecar)。
fn resolve_snap_bytes(
    sidecar: &git2::Repository,
    user: &git2::Repository,
    snap: &Snapshot,
    path: &str,
) -> Result<Option<(Vec<u8>, bool)>, CkptError> {
    let Some(entry) = snap.files.iter().find(|f| f.path == path) else {
        // anchor 时刻干净的路径 = 当时内容即 HEAD
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
    Ok(None) // existed=false 或 skip:该路径在 anchor 时刻无内容
}

/// 批次推导 + live 分类 + 状态合成(list 命令的主体)。
/// live 分类需要读工作区文件做逐字节比对 —— list 按需调用(UI 打开/批次更新),不挂轮询。
pub fn derive_batches(cwd: &str) -> Result<Vec<BatchInfo>, CkptError> {
    let manifests = load_manifests(cwd);
    let anchors: Vec<&Snapshot> = manifests.iter().filter(|s| s.kind == "anchor").collect();
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
            let (state, done_reason) = if reverted {
                ("reverted".into(), None)
            } else if open {
                ("pending".into(), None)
            } else if all_processed {
                (
                    "done".into(),
                    Some(if any_committed { "已提交".into() } else { "内容已变".into() }),
                )
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
fn classify_live(
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
fn batch_paths(
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

pub(crate) fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
