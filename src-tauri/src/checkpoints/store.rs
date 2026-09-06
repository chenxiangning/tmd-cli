//! 存储原语 —— 自 mod.rs 拆出(文件规模铁则)。
//! 锁(LEDGER_LOCK)/ 路径(base/ws/ledger/states)/ sidecar 与用户仓库句柄 /
//! 账本与 states.json 读写 / 条目 id 生成;类型与内容解析仍在 mod.rs。

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use super::{BatchState, CkptError, LedgerEntry};

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StatesFile {
    #[serde(default)]
    pub batches: BTreeMap<String, BatchState>,
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
pub(crate) fn base_dir() -> PathBuf {
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

pub(crate) fn ws_dir(cwd: &str) -> PathBuf {
    base_dir().join(crate::hash::md5_hex(cwd.to_string()))
}

#[cfg(test)]
pub(crate) fn ledger_file(cwd: &str) -> PathBuf {
    ws_dir(cwd).join("ledger.jsonl")
}

#[cfg(not(test))]
pub(crate) fn ledger_file(cwd: &str) -> PathBuf {
    ws_dir(cwd).join("ledger.jsonl")
}

pub(crate) fn states_file(cwd: &str) -> PathBuf {
    ws_dir(cwd).join("states.json")
}

/// 打开(必要时初始化)sidecar 裸仓库。只作 blob 对象库使用。
pub(crate) fn open_sidecar(cwd: &str) -> Result<git2::Repository, CkptError> {
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
pub(crate) fn open_user(cwd: &str) -> Result<git2::Repository, CkptError> {
    match git2::Repository::discover(cwd) {
        Ok(r) => Ok(r),
        Err(e) if e.code() == git2::ErrorCode::NotFound => Err(CkptError::NotARepo(cwd.into())),
        Err(e) => Err(e.into()),
    }
}

/// 写 blob 进 sidecar(内容寻址,重复内容自动去重)。
pub(crate) fn write_sidecar_blob(
    repo: &git2::Repository,
    data: &[u8],
) -> Result<String, CkptError> {
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
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)?;
    f.write_all(serde_json::to_string(entry).unwrap().as_bytes())?;
    f.write_all(b"\n")?;
    Ok(())
}

/// 读账本并折叠:同一 (kind, id) 多行以最后一行为准(turn 封口修订语义;
/// anchor 与 turn 共用 id 但 kind 不同,各自保留),保持文件顺序。
/// edit 行折叠键多了 path —— 每轮每文件独立一行。
pub(crate) fn load_ledger(cwd: &str) -> Vec<LedgerEntry> {
    let text = fs::read_to_string(ledger_file(cwd)).unwrap_or_default();
    let mut out: Vec<LedgerEntry> = Vec::new();
    // 折叠索引 O(1) 定位(此前线性扫描把单次读放大到 O(n²),事件流记账
    // 逐事件 append + list 秒级刷新,长账本不可接受)
    let mut index: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for line in text.lines() {
        let Ok(mut e) = serde_json::from_str::<LedgerEntry>(line) else {
            continue;
        };
        if e.attribution.is_empty() {
            e.attribution = "git".into(); // 旧账本缺省
        }
        let key = if e.kind == "edit" {
            format!("edit:{}:{}", e.id, e.path)
        } else {
            format!("{}:{}", e.kind, e.id)
        };
        match index.get(&key) {
            Some(&i) => out[i] = e,
            None => {
                index.insert(key, out.len());
                out.push(e);
            }
        }
    }
    out
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

pub(crate) fn load_states(cwd: &str) -> StatesFile {
    fs::read_to_string(states_file(cwd))
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

pub(crate) fn save_states(cwd: &str, states: &StatesFile) -> Result<(), CkptError> {
    let file = states_file(cwd);
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string(states).map_err(|e| CkptError::Store(e.to_string()))?;
    fs::write(&file, json)?;
    Ok(())
}

pub(crate) fn new_entry_id(ts: i64) -> String {
    format!("s{ts}-{}", SEQ.fetch_add(1, Ordering::SeqCst))
}

pub(crate) fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
