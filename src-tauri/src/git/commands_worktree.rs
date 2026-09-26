//! git worktree 编排(列表/新建/移除/清理悬空)—— 自 commands.rs 拆出的
//! Tauri command 层(文件规模铁则,先例 commands_pr)。
//! shell-out `git worktree`:libgit2 的 worktree 支持残缺(锁/prune 语义不全),
//! CLI 是唯一全功能面;exec_git 的 LC_ALL=C 环境与错误分类原样复用。

use super::commands::run;
use super::remote_ops::exec_git;
use serde::Serialize;

/// 一条 worktree 记录(porcelain 解析产物)。
#[derive(Debug, Serialize)]
pub struct WorktreeEntry {
    /// worktree 绝对路径(main 仓库也是一条)。
    pub path: String,
    pub head: String,
    /// 检出分支短名;detached/bare 为空。
    pub branch: String,
    pub detached: bool,
    pub bare: bool,
    pub locked: bool,
    /// 目录缺失等可 prune 状态。
    pub prunable: bool,
}

/// `git worktree list --porcelain` 解析(纯函数,单测覆盖)。
/// 记录块由 `worktree ` 行开启,空行仅作分隔不依赖。
fn parse_worktree_list(stdout: &str) -> Vec<WorktreeEntry> {
    let mut out: Vec<WorktreeEntry> = Vec::new();
    for line in stdout.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            continue;
        }
        if let Some(path) = line.strip_prefix("worktree ") {
            out.push(WorktreeEntry {
                path: path.to_string(),
                head: String::new(),
                branch: String::new(),
                detached: false,
                bare: false,
                locked: false,
                prunable: false,
            });
            continue;
        }
        let Some(cur) = out.last_mut() else { continue };
        if let Some(head) = line.strip_prefix("HEAD ") {
            cur.head = head.to_string();
        } else if let Some(branch) = line.strip_prefix("branch ") {
            cur.branch = branch.trim_start_matches("refs/heads/").to_string();
        } else if line == "detached" {
            cur.detached = true;
        } else if line == "bare" {
            cur.bare = true;
        } else if line.starts_with("locked") {
            cur.locked = true;
        } else if line.starts_with("prunable") {
            cur.prunable = true;
        }
    }
    out
}

/// 列出仓库全部 worktree。
#[tauri::command]
pub async fn git_worktree_list(cwd: String) -> Result<Vec<WorktreeEntry>, String> {
    let c = cwd.clone();
    run(cwd, move |repo| {
        let out = exec_git(
            repo,
            &c,
            &["worktree".into(), "list".into(), "--porcelain".into()],
        )?;
        let mut entries = parse_worktree_list(&out);
        rebase_porcelain_paths(&mut entries, &c);
        Ok(entries)
    })
    .await
}

/// porcelain 输出 canonical 路径(符号链接已解析,如 macOS /tmp→/private/tmp),
/// 而上层工作区 root 保留用户输入前缀;两侧字符串不等会造成主仓被误判为可
/// 移除、移除后工作区死条目。主仓条目精确映射回输入 cwd,兄弟 worktree 把
/// canonical 父目录前缀换回输入父目录前缀(cwd canonicalize 失败/Windows
/// verbatim 前缀不匹配时保持原样)。
fn rebase_porcelain_paths(entries: &mut [WorktreeEntry], cwd: &str) {
    let Ok(canon) = std::path::Path::new(cwd).canonicalize() else {
        return;
    };
    let canon_str = canon.to_string_lossy();
    let input_parent = std::path::Path::new(cwd)
        .parent()
        .map(|p| p.to_string_lossy())
        .unwrap_or_default();
    let canon_parent = canon
        .parent()
        .map(|p| p.to_string_lossy())
        .unwrap_or_default();
    for e in entries.iter_mut() {
        if e.path == canon_str {
            e.path = cwd.to_string();
        } else if let Some(rest) = e.path.strip_prefix(canon_parent.as_ref()) {
            if rest.starts_with('/') {
                e.path = format!("{input_parent}{rest}");
            }
        }
    }
}

/// 新建 worktree:new_branch = true 以 `-b <branch>` 新建分支(默认基于当前 HEAD),
/// false = 检出已有分支(该分支不得已被其他 worktree 检出,git 自校验)。
#[tauri::command]
pub async fn git_worktree_add(
    cwd: String,
    path: String,
    branch: String,
    new_branch: bool,
) -> Result<(), String> {
    let c = cwd.clone();
    run(cwd, move |repo| {
        /* 前导 '-' 会被 git 当选项解析成费解报错(non_empty_branch 同款纪律)。 */
        let branch_t = branch.trim();
        if branch_t.is_empty() || branch_t.starts_with('-') {
            return Err(super::error::GitError::empty(format!(
                "非法分支名: {branch_t}"
            )));
        }
        let mut args = vec!["worktree".to_string(), "add".to_string()];
        if new_branch {
            args.push("-b".into());
            args.push(branch.clone());
        }
        args.push(path);
        if !new_branch {
            args.push(branch);
        }
        exec_git(repo, &c, &args).map(|_| ())
    })
    .await
}

/// 移除 worktree(工作树未提交内容由 git 拒绝;force 才强拆)。
#[tauri::command]
pub async fn git_worktree_remove(cwd: String, path: String, force: bool) -> Result<(), String> {
    let c = cwd.clone();
    run(cwd, move |repo| {
        let mut args = vec!["worktree".to_string(), "remove".to_string()];
        if force {
            args.push("--force".into());
        }
        args.push(path);
        exec_git(repo, &c, &args).map(|_| ())
    })
    .await
}

/// 清理悬空记录(目录已被外部删除的 worktree 元数据)。
#[tauri::command]
pub async fn git_worktree_prune(cwd: String) -> Result<(), String> {
    let c = cwd.clone();
    run(cwd, move |repo| {
        exec_git(repo, &c, &["worktree".into(), "prune".into()]).map(|_| ())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::{parse_worktree_list, rebase_porcelain_paths, WorktreeEntry};

    const SAMPLE: &str = concat!(
        "worktree /repo/main\n",
        "HEAD abc123\n",
        "branch refs/heads/main\n",
        "\n",
        "worktree /repo/wt-feature\n",
        "HEAD def456\n",
        "branch refs/heads/feature/x\n",
        "locked why\n",
        "\n",
        "worktree /repo/det\n",
        "HEAD 999999\n",
        "detached\n",
        "prunable missing\n",
        "\n",
        "worktree /repo/bare\n",
        "bare\n",
    );

    fn entry(path: &str) -> WorktreeEntry {
        WorktreeEntry {
            path: path.to_string(),
            head: String::new(),
            branch: String::new(),
            detached: false,
            bare: false,
            locked: false,
            prunable: false,
        }
    }

    #[test]
    fn porcelain_解析_全字段() {
        let list = parse_worktree_list(SAMPLE);
        assert_eq!(list.len(), 4);
        assert_eq!(list[0].path, "/repo/main");
        assert_eq!(list[0].branch, "main");
        assert!(!list[0].locked);
        assert_eq!(list[1].branch, "feature/x"); // refs/heads/ 剥离
        assert!(list[1].locked);
        assert!(list[2].detached);
        assert!(list[2].prunable);
        assert!(list[3].bare);
        assert_eq!(list[3].head, ""); // bare 无 HEAD 行
    }

    #[test]
    fn 空输出_空列表() {
        assert!(parse_worktree_list("").is_empty());
    }

    #[test]
    fn 回贴_前缀边界_整段父目录才命中() {
        let base = std::env::temp_dir().join("tmd_wt_prefix_probe");
        let _ = std::fs::remove_dir_all(&base);
        let main = base.join("b").join("main");
        std::fs::create_dir_all(&main).unwrap();
        let canon_parent = main.canonicalize().unwrap().parent().unwrap().to_path_buf();
        let lookalike = canon_parent.with_file_name("b-repo");
        let mut entries = [
            entry(&lookalike.to_string_lossy()), /* /…/b-repo:前缀相似非整段 */
            entry(&canon_parent.join("wt2").to_string_lossy()),
        ];
        rebase_porcelain_paths(&mut entries, &main.to_string_lossy());
        assert_eq!(entries[0].path, lookalike.to_string_lossy()); // 原样
        assert_eq!(
            entries[1].path,
            base.join("b").join("wt2").to_string_lossy()
        ); // 回贴输入前缀
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn 回贴_真实符号链接目录() {
        let base = std::env::temp_dir().join("tmd_wt_rebase_probe");
        let _ = std::fs::remove_dir_all(&base);
        let repo = base.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let link = base.join("link");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&repo, &link).unwrap();
        #[cfg(not(unix))]
        {
            /* Windows symlink 需特权;该平台靠 verbatim 前缀不匹配保持原样。 */
            let _ = link;
            return;
        }
        let canon_repo = repo.canonicalize().unwrap();
        let sibling = canon_repo.parent().unwrap().join("wt-x");
        let mut entries = [
            entry(&canon_repo.to_string_lossy()),
            entry(&sibling.to_string_lossy()),
        ];
        rebase_porcelain_paths(&mut entries, &link.to_string_lossy());
        /* 主仓 → 输入(符号链接)路径;兄弟 → 输入父目录前缀。 */
        assert_eq!(entries[0].path, link.to_string_lossy());
        assert_eq!(entries[1].path, base.join("wt-x").to_string_lossy());
        let _ = std::fs::remove_dir_all(&base);
    }
}
