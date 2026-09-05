//! 分支菜单命令测试(rename / merge / rebase / branch compare / worktree diff)——
//! 对齐 codemoss 分支菜单复刻(2026-09-05-branch-menu-parity-design)。
//! merge/rebase/rename 走真实 git CLI(exec_git),compare/diff 走 git2 进程内。
//! 外部 CLI 写操作后必须 evict_cwd 再经 with_repo 读(缓存句柄对外部变更不新鲜)。

use super::tests_common::TempRepo;

use super::CommitInput;

/// stage 全部给定文件并提交(经面板同款 index_ops + commit 链路)。
fn commit_all(t: &TempRepo, message: &str, files: Vec<&str>) -> String {
    super::with_repo(t.path(), |r| {
        super::index_ops::stage(r, files.iter().map(|f| f.to_string()).collect())
    })
    .unwrap();
    super::evict_cwd(t.path());
    super::with_repo(t.path(), |r| {
        super::commit::commit(
            r,
            Vec::new(),
            CommitInput {
                message: message.into(),
                amend: false,
            },
        )
    })
    .unwrap()
}

/// 当前 HEAD 分支短名(init 后默认分支名不假设:libgit2 随全局 init.defaultBranch)。
fn head_branch(t: &TempRepo) -> String {
    super::with_repo(t.path(), |r| {
        Ok(r.head()
            .unwrap()
            .shorthand()
            .unwrap_or_default()
            .to_string())
    })
    .unwrap()
}

fn checkout(t: &TempRepo, branch: &str) {
    super::with_repo(t.path(), |r| super::branch_ops::checkout(r, branch)).unwrap();
}

/// 建分支(feat 自当前 HEAD 分出)。
fn branch_at_head(t: &TempRepo, name: &str) {
    super::with_repo(t.path(), |r| {
        let c = r.head().unwrap().peel_to_commit().unwrap();
        r.branch(name, &c, false).unwrap();
        Ok(())
    })
    .unwrap();
}

#[test]
fn branch_compare_双向唯一提交() {
    let t = TempRepo::new();
    t.write("a.txt", "base\n");
    commit_all(&t, "init", vec!["a.txt"]);
    let base = head_branch(&t);

    // feat 自 base 分出;双侧各前进一步(分叉)
    branch_at_head(&t, "feat");
    t.write("m.txt", "on main\n");
    let m1 = commit_all(&t, "on main", vec!["m.txt"]);
    checkout(&t, "feat");
    t.write("f.txt", "on feat\n");
    let f1 = commit_all(&t, "on feat", vec!["f.txt"]);
    super::evict_cwd(t.path());

    let set = super::with_repo(t.path(), |r| {
        super::compare_ops::branch_compare(r, "feat", &base, None)
    })
    .unwrap();
    let target_only: Vec<String> = set.target_only.iter().map(|c| c.long_sha.clone()).collect();
    let current_only: Vec<String> = set
        .current_only
        .iter()
        .map(|c| c.long_sha.clone())
        .collect();
    assert_eq!(target_only, vec![f1], "targetOnly 应只含 feat 独有提交");
    assert_eq!(
        current_only,
        vec![m1.clone()],
        "currentOnly 应只含 base 独有提交"
    );

    // target==current 双空;limit=0 clamp 到 1 不 panic
    let same = super::with_repo(t.path(), |r| {
        super::compare_ops::branch_compare(r, &base, &base, Some(0))
    })
    .unwrap();
    assert!(same.target_only.is_empty() && same.current_only.is_empty());
}

#[test]
fn worktree_files_与_patch_对分支差异() {
    let t = TempRepo::new();
    t.write("a.txt", "base\n");
    commit_all(&t, "init", vec!["a.txt"]);
    branch_at_head(&t, "feat");

    // base 前进:新增 b.txt(feat tip 里没有)
    t.write("b.txt", "added on main\n");
    commit_all(&t, "add b", vec!["b.txt"]);

    // 工作树再改 a.txt + untracked c.txt(相对 feat tip = init:三类状态齐全)
    t.write("a.txt", "changed\n");
    t.write("c.txt", "untracked\n");

    let files =
        super::with_repo(t.path(), |r| super::compare_ops::worktree_files(r, "feat")).unwrap();
    let status_of = |p: &str| files.iter().find(|f| f.path == p).map(|f| f.status.clone());
    assert_eq!(status_of("a.txt").as_deref(), Some("M"), "已跟踪改动 = M");
    assert_eq!(
        status_of("b.txt").as_deref(),
        Some("A"),
        "base 独有提交 = A"
    );
    assert_eq!(status_of("c.txt").as_deref(), Some("A"), "untracked = A");

    // patch 按需单文件:命中改动内容;未变动路径 None
    let patch = super::with_repo(t.path(), |r| {
        super::compare_ops::worktree_patch(r, "feat", "a.txt")
    })
    .unwrap()
    .unwrap();
    assert_eq!(patch.kind, "M");
    assert!(patch.patch.contains("-base") && patch.patch.contains("+changed"));
    let added = super::with_repo(t.path(), |r| {
        super::compare_ops::worktree_patch(r, "feat", "b.txt")
    })
    .unwrap()
    .unwrap();
    assert_eq!(added.kind, "A");
    let missing = super::with_repo(t.path(), |r| {
        super::compare_ops::worktree_patch(r, "feat", "nope.txt")
    })
    .unwrap();
    assert!(missing.is_none());

    // 不存在的分支引用报错(不 panic)
    assert!(
        super::with_repo(t.path(), |r| super::compare_ops::worktree_files(
            r,
            "origin/nope"
        ))
        .is_err()
    );
}

#[test]
fn rename_分支_upstream_配置随迁() {
    let t = TempRepo::new();
    t.write("a.txt", "base\n");
    commit_all(&t, "init", vec!["a.txt"]);
    branch_at_head(&t, "feat");
    super::with_repo(t.path(), |r| {
        let mut cfg = r.config().unwrap();
        cfg.set_str("branch.feat.remote", "origin").unwrap();
        cfg.set_str("branch.feat.merge", "refs/heads/feat").unwrap();
        Ok(())
    })
    .unwrap();

    super::with_repo(t.path(), |r| {
        super::branch_ops::rename(r, t.path(), "feat", "feat2")
    })
    .unwrap();
    super::evict_cwd(t.path());

    super::with_repo(t.path(), |r| {
        // 本地分支已更名,跟踪配置随迁(git branch -m 语义)
        r.find_branch("feat2", git2::BranchType::Local)
            .expect("feat2 应存在");
        assert!(r.find_branch("feat", git2::BranchType::Local).is_err());
        let cfg = r.config().unwrap();
        assert_eq!(cfg.get_string("branch.feat2.remote").unwrap(), "origin");
        assert_eq!(
            cfg.get_string("branch.feat2.merge").unwrap(),
            "refs/heads/feat"
        );
        assert!(
            cfg.get_string("branch.feat.remote").is_err(),
            "旧跟踪配置应已移除"
        );
        Ok(())
    })
    .unwrap();

    // 空名拒绝
    let empty = super::with_repo(t.path(), |r| {
        super::branch_ops::rename(r, t.path(), "feat2", "")
    });
    assert!(empty.is_err());
}

#[test]
fn merge_快进与非快进() {
    let t = TempRepo::new();
    t.write("a.txt", "base\n");
    commit_all(&t, "init", vec!["a.txt"]);
    let base = head_branch(&t);
    branch_at_head(&t, "feat");

    // feat 前进 f1;base 停在 init → 真 fast-forward 合并
    checkout(&t, "feat");
    t.write("f.txt", "feat\n");
    let f1 = commit_all(&t, "on feat", vec!["f.txt"]);
    checkout(&t, &base);
    super::with_repo(t.path(), |r| super::branch_ops::merge(r, t.path(), "feat")).unwrap();
    super::evict_cwd(t.path());
    let head = super::with_repo(t.path(), |r| {
        Ok(r.head().unwrap().peel_to_commit().unwrap().id().to_string())
    })
    .unwrap();
    assert_eq!(head, f1, "ff 合并后 HEAD 应为 feat tip");

    // 双侧各前进一步(分叉)→ merge commit 双亲
    t.write("m.txt", "main2\n");
    let m1 = commit_all(&t, "main2", vec!["m.txt"]);
    checkout(&t, "feat");
    t.write("g.txt", "feat2\n");
    commit_all(&t, "feat2", vec!["g.txt"]);
    checkout(&t, &base);
    super::with_repo(t.path(), |r| super::branch_ops::merge(r, t.path(), "feat")).unwrap();
    super::evict_cwd(t.path());
    super::with_repo(t.path(), |r| {
        let c = r.head().unwrap().peel_to_commit().unwrap();
        let parents: Vec<String> = c.parent_ids().map(|p| p.to_string()).collect();
        assert_eq!(parents.len(), 2, "分叉合并应产生 merge commit");
        assert!(
            parents.contains(&m1),
            "merge commit 双亲应含 base 侧提交 {m1}"
        );
        assert_eq!(
            r.revparse_single(&format!("refs/heads/{base}"))
                .unwrap()
                .peel_to_commit()
                .unwrap()
                .id()
                .to_string(),
            c.id().to_string(),
            "合并应落在当前分支 {base} 上"
        );
        Ok(())
    })
    .unwrap();
}

#[test]
fn rebase_当前分支重放到目标之上() {
    let t = TempRepo::new();
    t.write("a.txt", "base\n");
    commit_all(&t, "init", vec!["a.txt"]);
    let base = head_branch(&t);
    branch_at_head(&t, "feat");

    // base 前进 m1;feat 前进 f1(自 init 分出)
    t.write("m.txt", "m\n");
    let m1 = commit_all(&t, "m1", vec!["m.txt"]);
    checkout(&t, "feat");
    t.write("f.txt", "f\n");
    commit_all(&t, "f1", vec!["f.txt"]);

    // 当前分支 feat 变基到 base:f1 重放到 m1 之上
    super::with_repo(t.path(), |r| super::branch_ops::rebase(r, t.path(), &base)).unwrap();
    super::evict_cwd(t.path());
    super::with_repo(t.path(), |r| {
        let tip = r.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(
            tip.summary().unwrap_or_default(),
            "f1",
            "feat tip 应仍是 f1(重放)"
        );
        assert_eq!(tip.parent_id(0).unwrap().to_string(), m1, "f1 新父应为 m1");
        Ok(())
    })
    .unwrap();

    // 空目标名拒绝
    let empty = super::with_repo(t.path(), |r| super::branch_ops::rebase(r, t.path(), ""));
    assert!(empty.is_err());
}
