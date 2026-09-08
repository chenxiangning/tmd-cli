//! repos_scan —— workspace 根下的多仓发现原语(spec 2026-09-07-git-multi-repo-design §1)。
//! 一次性有界 BFS:零配置、无 watcher;深度上限由前端传(默认 2),结果上限 32。
//! `.git` 为文件(gitdir 指针)时按「root 的 .gitmodules 是否登记该路径」分
//! submodule / worktree;Repository::open 校验防误报。
//! 输出 path 以输入 root 原始串为前缀(内部 canonicalize 仅用于遍历),
//! 按 path 排序 —— root 自身是仓时天然排首位。

use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};

use git2::Repository;
use serde::Serialize;

use super::GitError;

/// 结果数上限:超出即截断(truncated = true)。典型多仓 ≤10,32 已是引导列表的合理上限。
const MAX_REPOS: usize = 32;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RepoSummary {
    /// 绝对路径(输入 root 原始形态前缀)
    pub path: String,
    /// 目录名
    pub name: String,
    /// HEAD shorthand;detached / unborn 为空串
    pub branch: String,
    /// "repo" | "worktree" | "submodule"
    pub kind: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RepoScanResult {
    pub repos: Vec<RepoSummary>,
    pub truncated: bool,
}

pub fn scan(root: &str, max_depth: u32) -> Result<RepoScanResult, GitError> {
    let canonical =
        fs::canonicalize(root).map_err(|e| GitError::Shell(format!("扫描根不可访问: {e}")))?;
    let submodules = submodule_paths(&canonical);

    // 全量收集后排序再截断:read_dir 顺序不定,「前 32」必须是 path 序才确定
    let mut repos: Vec<RepoSummary> = Vec::new();
    let mut queue: VecDeque<(PathBuf, u32)> = VecDeque::from([(canonical.clone(), 0)]);
    while let Some((dir, depth)) = queue.pop_front() {
        if let Some(summary) = probe(&dir, &canonical, root, &submodules) {
            repos.push(summary);
        }
        if depth >= max_depth {
            continue;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for e in entries.flatten() {
            if e.file_name() == ".git" {
                continue;
            }
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                queue.push_back((e.path(), depth + 1));
            }
        }
    }

    repos.sort_by(|a, b| a.path.cmp(&b.path));
    let truncated = repos.len() > MAX_REPOS;
    repos.truncate(MAX_REPOS);
    Ok(RepoScanResult { repos, truncated })
}

/// dir 是仓则返回摘要,否则 None(非仓 / .git 指针失效)。
/// probe 校验 = Repository::open 成功;不进 with_repo 缓存(发现是低频只读,
/// 32 仓每仓 open 几 ms,不值得占 FIFO 句柄位)。
fn probe(
    dir: &Path,
    canonical_root: &Path,
    display_root: &str,
    submodules: &[PathBuf],
) -> Option<RepoSummary> {
    let dot = dir.join(".git");
    let meta = fs::metadata(&dot).ok()?;
    let kind = if meta.is_file() {
        if submodules.iter().any(|s| s == dir) {
            "submodule"
        } else {
            "worktree"
        }
    } else {
        "repo"
    };
    let repo = Repository::open(dir).ok()?;
    let branch = match repo.head() {
        Ok(h) if h.is_branch() => h.shorthand().unwrap_or("").to_string(),
        _ => String::new(),
    };
    // 输出以输入 root 原始形态为前缀:canonical 与配置根(软链形态)保持一致口径
    let rel = dir.strip_prefix(canonical_root).ok()?;
    let path = if rel.as_os_str().is_empty() {
        display_root.to_string()
    } else {
        Path::new(display_root)
            .join(rel)
            .to_string_lossy()
            .into_owned()
    };
    Some(RepoSummary {
        path,
        name: dir.file_name()?.to_string_lossy().into_owned(),
        branch,
        kind: kind.to_string(),
    })
}

/// 解析 root/.gitmodules 的 submodule 登记路径集合(绝对);无文件/解析失败 = 空。
fn submodule_paths(root: &Path) -> Vec<PathBuf> {
    let file = root.join(".gitmodules");
    if !file.is_file() {
        return Vec::new();
    }
    let Ok(cfg) = git2::Config::open(&file) else {
        return Vec::new();
    };
    let mut entries = match cfg.entries(Some("submodule.*.path")) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    while let Some(e) = entries.next() {
        if let Ok(e) = e {
            if let Some(v) = e.value() {
                out.push(root.join(v));
            }
        }
    }
    out
}
