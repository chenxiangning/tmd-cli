//! git worktree 编排(列表/新建/移除/清理悬空)—— 自 commands.rs 拆出的
//! Tauri command 层(文件规模铁则,先例 commands_pr)。
//! shell-out `git worktree`:libgit2 的 worktree 支持残缺(锁/prune 语义不全),
//! CLI 是唯一全功能面;exec_git 的 LC_ALL=C 环境与错误分类原样复用。

use super::commands::{run, run_mut};
use super::error::GitError;
use super::remote_ops::exec_git;
use super::worktree_parse::{parse_worktree_list, rebase_porcelain_paths, WorktreeEntry};
use git2::Repository;

/// 新建分支预检:分支已存在时给可行动指引(git 原生 fatal 经 E_SHELL 难懂;
/// 2026-09-26 实证:删除 worktree 后重建同名,raw fatal 让人摸不着头脑)。
fn ensure_branch_free(repo: &Repository, cwd: &str, branch: &str) -> Result<(), GitError> {
    match exec_git(
        repo,
        cwd,
        &[
            "show-ref".into(),
            "--verify".into(),
            "--quiet".into(),
            format!("refs/heads/{branch}"),
        ],
    ) {
        Ok(_) => Err(GitError::empty(format!(
            "分支 {branch} 已存在:可关闭「新建分支」直接检出它,或换一个名字"
        ))),
        /* show-ref 未命中 = 非零退出码(Shell);超时/取消类真故障上抛,
         * 不折叠成「不存在」放行(2026-09-27 评审)。 */
        Err(GitError::Shell(_)) => Ok(()),
        Err(e) => Err(e),
    }
}

/// 列出仓库全部 worktree(porcelain 解析与路径回贴在 worktree_parse)。
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
    /* worktree add/remove 改 .git 目录(外部 CLI 写):run_mut 成功后 evict,
     * 否则缓存句柄的 refdb 陈旧,新分支不随 bumpGitRefresh 出现(评审 P1)。 */
    run_mut(cwd, move |repo| {
        /* 前导 '-' 会被 git 当选项解析成费解报错(non_empty_branch 同款纪律)。 */
        let branch_t = branch.trim();
        if branch_t.is_empty() || branch_t.starts_with('-') {
            return Err(GitError::empty(format!("非法分支名: {branch_t}")));
        }
        if path.is_empty() || path.starts_with('-') {
            return Err(GitError::empty(format!("非法路径: {path}")));
        }
        if new_branch {
            ensure_branch_free(repo, &c, branch_t)?;
        }
        let mut args = vec!["worktree".to_string(), "add".to_string()];
        if new_branch {
            args.push("-b".into());
            args.push(branch_t.to_string());
        }
        args.push(path);
        if !new_branch {
            args.push(branch_t.to_string());
        }
        exec_git(repo, &c, &args).map(|_| ())
    })
    .await
}

/// 移除 worktree(工作树未提交内容由 git 拒绝;force 才强拆)。
#[tauri::command]
pub async fn git_worktree_remove(cwd: String, path: String, force: bool) -> Result<(), String> {
    let c = cwd.clone();
    run_mut(cwd, move |repo| {
        /* 前导 '-' 会被 git 当选项解析;与 git_worktree_add 同款闸。 */
        if path.is_empty() || path.starts_with('-') {
            return Err(GitError::empty(format!("非法路径: {path}")));
        }
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
    run_mut(cwd, move |repo| {
        exec_git(repo, &c, &["worktree".into(), "prune".into()]).map(|_| ())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::ensure_branch_free;

    #[test]
    fn 预检_分支已存在给指引_不存在放行() {
        let t = crate::git::tests_common::TempRepo::new();
        let repo = git2::Repository::open(&t.dir).unwrap();
        let run_git = |args: &[&str]| {
            std::process::Command::new("git")
                .args(args)
                .current_dir(&t.dir)
                .output()
                .unwrap()
        };
        assert!(run_git(&["commit", "--allow-empty", "-m", "init"])
            .status
            .success());
        assert!(run_git(&["branch", "dup"]).status.success());
        /* 已存在:可行动指引(非 raw fatal)。 */
        let err = ensure_branch_free(&repo, t.dir.to_str().unwrap(), "dup").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("已存在") && msg.contains("检出"));
        /* 不存在:放行。 */
        assert!(ensure_branch_free(&repo, t.dir.to_str().unwrap(), "fresh").is_ok());
    }
}
