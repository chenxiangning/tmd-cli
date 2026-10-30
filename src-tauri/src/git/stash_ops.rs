//! stash —— 「暂存并切换」(复刻 IDEA Smart Checkout)。
//!
//! 直接切换本来就携带不冲突的未提交改动(safe checkout 语义);本模块处理
//! 冲突场景:stash -u(连 untracked)→ 切换 → apply 恢复。
//! 注意 libgit2 的 stash_pop 与 git CLI 不同:冲突时也返回 Ok 并丢弃 stash
//! (实测),故这里用 stash_apply + index.has_conflicts() 显式判冲,
//! 冲突时保留 stash 不丢,文件已标冲突,由用户在编辑器解决。

use git2::Repository;
use serde::Serialize;

use super::{branch_ops, status, GitError};

/// stash 管理面条目(0.4.5:list/apply/pop/drop;此前 stash 仅智能切换内部使用)。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub index: u32,
    /// stash 消息(stash_save 时写入,如「tmd: 分支切换前自动暂存」)。
    pub message: String,
    pub short_sha: String,
    /// stash 提交时刻(unix 秒)。
    pub when: i64,
}

/// 列出全部 stash(index 升序,0 = 最近)。无 stash = 空表(面板不出条)。
/// stash_foreach 要求 &mut(与 undo 同律);先收集三元组再查提交时刻,防闭包再借 repo。
pub fn list(repo: &mut Repository) -> Result<Vec<StashEntry>, GitError> {
    let mut raw: Vec<(usize, String, git2::Oid)> = Vec::new();
    repo.stash_foreach(|index, message, id| {
        raw.push((index, message.to_string(), *id));
        true
    })?;
    Ok(raw
        .into_iter()
        .map(|(index, message, id)| StashEntry {
            index: index as u32,
            when: repo
                .find_commit(id)
                .map(|c| c.time().seconds())
                .unwrap_or(0),
            short_sha: id.to_string().chars().take(7).collect(),
            message,
        })
        .collect())
}

/// 应用 stash 条目。keep = true 保留条目(apply 语义);false = 弹出(pop 语义,
/// 与 restore 同律:应用后按 index 冲突态分派 —— 干净才 drop,冲突保留不丢)。
pub fn apply(repo: &mut Repository, index: u32, keep: bool) -> Result<(), GitError> {
    let idx = index as usize;
    repo.stash_apply(idx, None)?;
    if !keep && !repo.index()?.has_conflicts() {
        repo.stash_drop(idx)?;
    }
    Ok(())
}

/// 丢弃 stash 条目(不可逆;前端确认框把关)。
pub fn drop(repo: &mut Repository, index: u32) -> Result<(), GitError> {
    repo.stash_drop(index as usize)?;
    Ok(())
}

const STASH_MSG: &str = "tmd: 分支切换前自动暂存";
/// 手动创建(StashBar「+ stash」)的默认消息:与智能切换的自动消息区分。
const STASH_MSG_MANUAL: &str = "tmd: 手动暂存";

fn push(repo: &mut Repository, msg: &str) -> Result<bool, GitError> {
    let st = status::compute(repo)?;
    if st.files.is_empty() {
        return Ok(false);
    }
    if st.files.iter().any(|f| f.status == "C") {
        return Err(GitError::empty(
            "工作区存在未解决的合并冲突,请先解决冲突后再操作",
        ));
    }
    // stash_save 必须显式签名:复用提交面板的兜底链(config → env → 内置),不因缺 user 配置炸掉
    let sig = super::commit::resolve_signature(repo)?;
    repo.stash_save(&sig, msg, Some(git2::StashFlags::INCLUDE_UNTRACKED))?;
    Ok(true)
}

/// 手动创建 stash(StashBar「+ stash」):message 空白 = 默认文案;返回
/// false = 工作区干净(无可暂存)。护栏与智能切换同源(冲突拒绝、-u、签名兜底)。
pub fn create(repo: &mut Repository, message: &str) -> Result<bool, GitError> {
    let msg = message.trim();
    push(
        repo,
        if msg.is_empty() {
            STASH_MSG_MANUAL
        } else {
            msg
        },
    )
}

fn checkout_by(repo: &Repository, name: &str, remote: bool) -> Result<(), GitError> {
    if remote {
        branch_ops::checkout_remote(repo, name)
    } else {
        branch_ops::checkout(repo, name)
    }
}

/// 恢复 stash[0]:apply 后按 index 冲突态分派 —— 干净则 drop,冲突则保留。
fn restore(repo: &mut Repository, name: &str) -> Result<(), GitError> {
    repo.stash_apply(0, None).map_err(|e| {
        GitError::empty(format!(
            "已切换到 {name};恢复暂存改动失败,改动仍保留在 stash \
             (git stash pop 重试 / git stash drop 丢弃)({})",
            e.message()
        ))
    })?;
    if repo.index()?.has_conflicts() {
        return Err(GitError::empty(format!(
            "已切换到 {name};暂存的改动与目标分支有冲突,已标记在文件中,请解决后提交。\
             原改动仍保留在 stash(确认无误后 git stash drop 丢弃)"
        )));
    }
    repo.stash_drop(0)?;
    Ok(())
}

/// 还原一次「暂存并切换」:reset --hard 丢弃切换后分支上的冲突标记与携带改动
/// (内容都在 stash 里),切回原分支,再 apply 恢复。
/// 无 stash 时拒绝 —— 没有备份时 reset 是纯丢弃,绝不盲目执行。
pub fn undo(repo: &mut Repository, original: &str) -> Result<(), GitError> {
    let mut n = 0;
    repo.stash_foreach(|_, _, _| {
        n += 1;
        true
    })?;
    if n == 0 {
        return Err(GitError::empty(
            "没有找到切换时自动暂存的改动,无可还原内容(可能已成功应用或被丢弃)",
        ));
    }
    {
        // Commit 带 Drop,借用须在 &mut 使用前结束 —— 作用域化
        let head_commit = repo.head()?.peel_to_commit()?;
        repo.reset(head_commit.as_object(), git2::ResetType::Hard, None)?;
    }
    branch_ops::checkout(repo, original)?;
    restore(repo, original)
}

/// 智能切换:干净直切;脏 → stash → 切换 → apply 恢复(冲突保留 stash)。
pub fn smart_checkout(repo: &mut Repository, name: &str, remote: bool) -> Result<(), GitError> {
    if !push(repo, STASH_MSG)? {
        return checkout_by(repo, name, remote);
    }
    if let Err(e) = checkout_by(repo, name, remote) {
        // 极少:干净树切换仍失败(如引用被并发改写)。apply 恢复现场(不 drop,安全优先)。
        let _ = repo.stash_apply(0, None);
        return Err(e);
    }
    restore(repo, name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::tests_common::TempRepo;

    fn commit_all(repo: &Repository) {
        let mut index = repo.index().unwrap();
        let mut opts = git2::StatusOptions::new();
        opts.include_untracked(true);
        let paths: Vec<String> = repo
            .statuses(Some(&mut opts))
            .unwrap()
            .iter()
            .filter_map(|e| e.path().map(|p| p.to_string()))
            .collect();
        for p in paths {
            index.add_path(std::path::Path::new(&p)).unwrap();
        }
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = repo.signature().unwrap();
        let mut parents: Vec<git2::Commit> = Vec::new();
        if let Ok(h) = repo.head() {
            if let Ok(c) = h.peel_to_commit() {
                parents.push(c);
            }
        }
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &parent_refs)
            .unwrap();
    }

    #[test]
    fn stash_管理面_列表应用弹出全链() {
        let tr = TempRepo::new();
        tr.write("a.txt", "v1\n");
        let repo = git2::Repository::open(tr.path()).unwrap();
        commit_all(&repo);

        // 无 stash:空表
        let mut repo = repo;
        assert!(list(&mut repo).unwrap().is_empty());

        // 脏工作区 stash_save → 列表 1 条(带消息与短 sha)
        tr.write("a.txt", "v2\n");
        let sig = repo.signature().unwrap();
        repo.stash_save(
            &sig,
            "tmd: 测试暂存",
            Some(git2::StashFlags::INCLUDE_UNTRACKED),
        )
        .unwrap();
        let entries = list(&mut repo).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].index, 0);
        assert!(entries[0].message.contains("测试暂存"));
        assert_eq!(entries[0].short_sha.len(), 7);
        assert!(entries[0].when > 0);

        // 应用保留:工作区恢复 v2,条目仍在
        apply(&mut repo, 0, true).unwrap();
        assert_eq!(
            std::fs::read_to_string(format!("{}/a.txt", tr.path())).unwrap(),
            "v2\n"
        );
        assert_eq!(list(&mut repo).unwrap().len(), 1);

        // 弹出(pop 语义):条目移除
        apply(&mut repo, 0, false).unwrap();
        assert!(list(&mut repo).unwrap().is_empty());

        // 丢弃:越界 index 报错不 panic
        assert!(drop(&mut repo, 0).is_err());
        let _ = std::fs::remove_dir_all(tr.path());
    }

    #[test]
    fn stash_手动创建_消息语义与干净拒绝() {
        let tr = TempRepo::new();
        tr.write("a.txt", "v1\n");
        let mut repo = git2::Repository::open(tr.path()).unwrap();
        commit_all(&repo);

        // 干净工作区:Ok(false) 不建条
        assert!(!create(&mut repo, "msg").unwrap());
        assert!(list(&mut repo).unwrap().is_empty());

        // 自定义消息(含首尾空白,应修剪)入列
        tr.write("a.txt", "v2\n");
        assert!(create(&mut repo, "  手动测试  ").unwrap());
        let entries = list(&mut repo).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].message.contains("手动测试"));

        // 空消息 = 默认文案;untracked 也入 stash(-u 与智能切换同款)
        tr.write("new.txt", "u\n");
        assert!(create(&mut repo, "").unwrap());
        let entries = list(&mut repo).unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries[0].message.contains("手动暂存"));
        let _ = std::fs::remove_dir_all(tr.path());
    }
}
