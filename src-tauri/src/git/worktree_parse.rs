//! worktree porcelain 解析与路径回贴(纯函数,从 commands_worktree 拆出:
//! 文件规模铁则,先例 commands_pr / relay_selfhost_persist)。
//! porcelain 输出 canonical 路径的回贴口径见 rebase_porcelain_paths 契约注释。

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
pub(crate) fn parse_worktree_list(stdout: &str) -> Vec<WorktreeEntry> {
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

/// Windows 形态归一(比较用):去 \\?\ verbatim 前缀、反斜杠转正斜杠、整串小写。
/// 仅作比较键,不回写用户可见路径;NTFS/APFS 大小写不敏感,盘符与目录段都可能
/// 大小写漂移。非 Windows 形态(含 POSIX 反斜杠文件名)原样返回 —— 恒等保序。
pub(crate) fn normalize_windows_shape(p: &str) -> String {
    let bytes = p.as_bytes();
    let verbatim = p.starts_with(r"\\?\");
    let drive = bytes.len() >= 2 && bytes[1] == b':' && (bytes[0] as char).is_ascii_alphabetic();
    if !verbatim && !drive {
        return p.to_string();
    }
    let p = p.strip_prefix(r"\\?\").unwrap_or(p);
    p.replace('\\', "/").to_ascii_lowercase()
}

pub(crate) fn rebase_porcelain_paths(entries: &mut [WorktreeEntry], cwd: &str) {
    /* 比较前两侧归一,回贴保持调用方 cwd 原形态。Windows:canonicalize 产
    \\?\C:\…(verbatim 反斜杠),git porcelain 产 C:/…(正斜杠盘符)——
    Prefix(VerbatimDisk) ≠ Prefix(Disk) 且分隔符不同,逐组件比较永不匹配,
    本函数在 Windows 曾恒为 no-op(2026-09-28 评审 F-GIT-001)。 */
    let Ok(canon) = std::path::Path::new(cwd).canonicalize() else {
        return;
    };
    let canon_str = normalize_windows_shape(&canon.to_string_lossy());
    let input_parent = std::path::Path::new(cwd)
        .parent()
        .map(|p| p.to_string_lossy())
        .unwrap_or_default();
    let canon_parent = normalize_windows_shape(
        &canon
            .parent()
            .map(|p| p.to_string_lossy())
            .unwrap_or_default(),
    );
    for e in entries.iter_mut() {
        let path_norm = normalize_windows_shape(&e.path);
        if path_norm == canon_str {
            e.path = cwd.to_string();
        } else if let Some(rest) = path_norm.strip_prefix(&canon_parent) {
            if rest.starts_with('/') {
                e.path = format!("{input_parent}{rest}");
            }
        }
    }
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
    fn windows_形态归一_verbatim_与_porcelain_盘符互认() {
        // 纯函数语义测试(POSIX 主机亦可跑):canonicalize 侧 verbatim 反斜杠、
        // porcelain 侧正斜杠盘符,归一后互认;POSIX 路径(含反斜杠文件名)不动。
        assert_eq!(
            super::normalize_windows_shape(r"\\?\C:\Users\x\repo"),
            "c:/users/x/repo"
        );
        assert_eq!(
            super::normalize_windows_shape("C:/Users/x/repo"),
            "c:/users/x/repo"
        );
        assert_eq!(super::normalize_windows_shape("/repo/main"), "/repo/main");
        assert_eq!(
            super::normalize_windows_shape(r"/repo/back\slash"),
            "/repo/back\\slash"
        );
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
