//! Git 服务 —— libgit2 原语 + Repo 句柄缓存;远端操作(fetch/pull/push)shell-out。
//!
//! 契约见 openspec/changes/git-right-panel/{proposal,design}.md。
//! 关键不变量:
//! - cwd 是唯一维度(Session = cwd + PTY),不引 workspaceId。
//! - Repository 在 git2 0.20 是 Send 但 !Sync(裸指针包装)——
//!   缓存为 Arc<Mutex<Repository>>:外层锁仅 lookup/insert 纳秒级当场释放,
//!   内层锁容纳单次 git 操作;同 repo 串行、跨 repo 并行。锁顺序恒为 外→内
//!   且外层锁申请内层前已释放,无死锁面。
//! - 所有 index 操作必须经 fresh_index(index.read(true)),防外部终端 git add 后 stale。
//! - 写操作由 commands 层成功后 evict_cwd,不暴露 invalidate IPC。

mod branch_ops;
mod commit;
mod diff;
mod error;
mod index_ops;
mod log;
mod remote_ops;
mod status;

pub mod commands;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_common;
#[cfg(test)]
mod tests_write_ops;

use git2::Repository;
use parking_lot::Mutex;
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};

pub use branch_ops::BranchList;
pub use commit::CommitInput;
pub use diff::{DiffTotals, FilePatch};
pub use error::GitError;
pub use log::{walk as walk_log, LogEntry};
pub use status::{ahead_behind, AheadBehind, DiffStatus};

/// 进程级 Repo 缓存。key = canonicalize 后的 cwd(避软链/相对路径抖动)。
/// FIFO 上限 16:长跑 app 跨多 workspace 不无限积压 Repository 句柄。
const REPO_CACHE_LIMIT: usize = 16;

struct RepoCache {
    map: HashMap<PathBuf, Arc<Mutex<Repository>>>,
    order: VecDeque<PathBuf>,
}

impl RepoCache {
    fn get(&self, key: &Path) -> Option<Arc<Mutex<Repository>>> {
        self.map.get(key).cloned()
    }

    fn insert(&mut self, key: PathBuf, repo: Arc<Mutex<Repository>>) {
        if !self.map.contains_key(&key) {
            self.order.push_back(key.clone());
        }
        self.map.insert(key, repo);
        while self.order.len() > REPO_CACHE_LIMIT {
            if let Some(oldest) = self.order.pop_front() {
                self.map.remove(&oldest);
            }
        }
    }

    fn remove(&mut self, key: &Path) {
        self.map.remove(key);
        self.order.retain(|k| k != key);
    }
}

static REPO_CACHE: LazyLock<Mutex<RepoCache>> = LazyLock::new(|| {
    Mutex::new(RepoCache {
        map: HashMap::new(),
        order: VecDeque::new(),
    })
});

/// 取/建 cwd 对应的 Repository 句柄并执行 f。
/// 外层锁临界区仅 HashMap 操作,锁内零 git2 调用 → 无锁顺序问题。
pub fn with_repo<T>(
    cwd: &str,
    f: impl FnOnce(&Repository) -> Result<T, GitError>,
) -> Result<T, GitError> {
    let key = canonicalize_cwd(cwd)?;
    let arc = {
        let cached = REPO_CACHE.lock().get(&key);
        match cached {
            Some(a) => a,
            None => {
                let arc = Arc::new(Mutex::new(Repository::discover(&key).map_err(|e| {
                    if e.code() == git2::ErrorCode::NotFound {
                        GitError::NotARepo(key.display().to_string())
                    } else {
                        GitError::Libgit2(e)
                    }
                })?));
                REPO_CACHE.lock().insert(key, arc.clone());
                arc
            }
        }
    }; // 外层锁已释放,再申请内层
    let repo = arc.lock();
    f(&repo)
}

/// 写操作(commit/checkout/stage/discard/branch_delete)成功后由 commands 层调用。
/// 保守 evict:下次访问重新 open(几十 ms),换取外部 CLI 变更后的绝对新鲜。
pub fn evict_cwd(cwd: &str) {
    if let Ok(key) = canonicalize_cwd(cwd) {
        REPO_CACHE.lock().remove(&key);
    }
}

fn canonicalize_cwd(cwd: &str) -> Result<PathBuf, GitError> {
    let p = Path::new(cwd);
    if cwd.trim().is_empty() {
        return Err(GitError::Empty("cwd 为空".into()));
    }
    // canonicalize 要求路径存在;cwd 短暂消失时退回原路径,discover 会精准报 NotARepo
    Ok(p.canonicalize().unwrap_or_else(|_| p.to_path_buf()))
}

/// libgit2 的 Index 是内存缓存;外部 `git add` 后必须 read(true) 强制重读。
/// 所有 index 操作的唯一入口。
fn fresh_index(repo: &Repository) -> Result<git2::Index, GitError> {
    let mut index = repo.index()?;
    index.read(true)?;
    Ok(index)
}
