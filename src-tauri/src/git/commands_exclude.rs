//! sidecar 本地排除命令 —— tmd 自建目录(.tmd/ 等)的零污染约定。

use super::commands::run;

/// 条目追加进仓库本地排除(.git/info/exclude):tmd sidecar(.tmd/ 等)的零污染
/// 约定 —— .gitignore 不动、不入版本库;worktree cwd 经 git2 解析到该树的
/// gitdir,排除局部生效。幂等:已含同文本行不重复追加。非 git 仓报 NotARepo。
#[tauri::command]
pub async fn git_ensure_local_exclude(cwd: String, pattern: String) -> Result<(), String> {
    run(cwd, move |repo| {
        let needle = pattern.trim().to_string();
        let dir = repo.path().join("info");
        std::fs::create_dir_all(&dir)?;
        let path = dir.join("exclude");
        let existing = std::fs::read_to_string(&path).unwrap_or_default();
        if existing.lines().any(|l| l.trim() == needle) {
            return Ok(());
        }
        let mut out = existing;
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(&needle);
        out.push('\n');
        std::fs::write(&path, out)?;
        Ok(())
    })
    .await
}
