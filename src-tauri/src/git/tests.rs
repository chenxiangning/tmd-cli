//! git 模块集成测试 —— tempdir 建真实 repo,覆盖 happy path 全链路。
//! 不引 tempfile:std::env::temp_dir + 进程/时间戳构造唯一目录,Drop 清理。

use super::tests_common::TempRepo;

#[test]
fn status_untracked_then_staged() {
    let t = TempRepo::new();
    // 空仓库(无 commit):head 是 unborn —— compute 应报错或给空;
    // 先造首个 commit 让 head 落地
    t.write("a.txt", "v1");
    let sha = super::with_repo(t.path(), |r| {
        super::commit::commit(
            r,
            vec!["a.txt".into()],
            super::CommitInput {
                message: "init".into(),
                amend: false,
            },
        )
    })
    .unwrap();
    assert_eq!(sha.len(), 40);
    super::evict_cwd(t.path());

    // 改动 + 新文件 → 两种状态
    t.write("a.txt", "v2");
    t.write("b.txt", "new");
    let st = super::with_repo(t.path(), super::status::compute).unwrap();
    assert_eq!(st.branch, "master");
    let a = st.files.iter().find(|f| f.path == "a.txt").unwrap();
    assert_eq!((a.status.as_str(), a.staged), ("M", false));
    let b = st.files.iter().find(|f| f.path == "b.txt").unwrap();
    assert_eq!((b.status.as_str(), b.staged), ("?", false));

    // stage 后
    super::with_repo(t.path(), |r| {
        super::index_ops::stage(r, vec!["b.txt".into()])
    })
    .unwrap();
    super::evict_cwd(t.path());
    let st = super::with_repo(t.path(), super::status::compute).unwrap();
    let b = st.files.iter().find(|f| f.path == "b.txt").unwrap();
    assert_eq!((b.status.as_str(), b.staged), ("A", true));
}

#[test]
fn status_aggregate_totals() {
    let t = TempRepo::new();
    t.write("a.txt", "one\ntwo\n");
    super::with_repo(t.path(), |r| {
        super::commit::commit(
            r,
            vec!["a.txt".into()],
            super::CommitInput {
                message: "init".into(),
                amend: false,
            },
        )
    })
    .unwrap();
    super::evict_cwd(t.path());

    // 改 1 行(+1 -1)+ untracked 新文件整文件计入(+3)→ +4 -1
    t.write("a.txt", "ONE\ntwo\n");
    t.write("b.txt", "x\ny\nz\n");
    let totals = super::with_repo(t.path(), super::diff::totals_of).unwrap();
    assert_eq!((totals.insertions, totals.deletions), (4, 1));

    // 全部 stage 后总数不变(两侧求和口径)
    super::with_repo(t.path(), |r| {
        super::index_ops::stage(r, vec!["a.txt".into(), "b.txt".into()])
    })
    .unwrap();
    let totals = super::with_repo(t.path(), super::diff::totals_of).unwrap();
    assert_eq!((totals.insertions, totals.deletions), (4, 1));
}

#[test]
fn empty_commit_rejected() {
    let t = TempRepo::new();
    t.write("a.txt", "v1");
    super::with_repo(t.path(), |r| {
        super::commit::commit(
            r,
            vec!["a.txt".into()],
            super::CommitInput {
                message: "init".into(),
                amend: false,
            },
        )
    })
    .unwrap();
    super::evict_cwd(t.path());

    // 无变更再提交 → E_EMPTY
    let err = super::with_repo(t.path(), |r| {
        super::commit::commit(
            r,
            vec![],
            super::CommitInput {
                message: "x".into(),
                amend: false,
            },
        )
    })
    .unwrap_err();
    assert!(String::from(err).starts_with("E_EMPTY:"));

    // 空 message → E_EMPTY
    let t2 = TempRepo::new();
    let err = super::with_repo(t2.path(), |r| {
        super::commit::commit(
            r,
            vec![],
            super::CommitInput {
                message: "  ".into(),
                amend: false,
            },
        )
    })
    .unwrap_err();
    assert!(String::from(err).starts_with("E_EMPTY:"));
}

#[test]
fn diff_patch_contains_changes() {
    let t = TempRepo::new();
    t.write("a.txt", "line1\nline2\n");
    super::with_repo(t.path(), |r| {
        super::commit::commit(
            r,
            vec!["a.txt".into()],
            super::CommitInput {
                message: "init".into(),
                amend: false,
            },
        )
    })
    .unwrap();
    super::evict_cwd(t.path());

    t.write("a.txt", "line1\nline2\nline3\n");
    let patch = super::with_repo(t.path(), |r| super::diff::file_patch(r, "a.txt", false))
        .unwrap()
        .unwrap();
    assert_eq!(patch.kind, "M");
    assert_eq!(patch.additions, 1);
    assert_eq!(patch.deletions, 0);
    assert!(patch.patch.contains("+line3"));
}

#[test]
fn totals_per_file_numstat_matches_aggregate() {
    // 每文件 numstat:侧别标记正确、聚合值 = files 求和、untracked 整文件计入 wt 侧
    let t = TempRepo::new();
    t.write("a.txt", "one\ntwo\n");
    super::with_repo(t.path(), |r| {
        super::commit::commit(
            r,
            vec!["a.txt".into()],
            super::CommitInput {
                message: "init".into(),
                amend: false,
            },
        )
    })
    .unwrap();
    super::evict_cwd(t.path());

    // a.txt wt 侧 +1 -1;b.txt untracked 整文件 +3(仅 wt 侧)
    t.write("a.txt", "ONE\ntwo\n");
    t.write("b.txt", "x\ny\nz\n");
    let totals = super::with_repo(t.path(), super::diff::totals_of).unwrap();
    assert_eq!((totals.insertions, totals.deletions), (4, 1));
    let wa = totals.files.iter().find(|f| f.path == "a.txt").unwrap();
    assert_eq!((wa.staged, wa.insertions, wa.deletions), (false, 1, 1));
    let wb = totals.files.iter().find(|f| f.path == "b.txt").unwrap();
    assert_eq!((wb.staged, wb.insertions, wb.deletions), (false, 3, 0));
    let sum: (u32, u32) = totals
        .files
        .iter()
        .map(|f| (f.insertions, f.deletions))
        .reduce(|(a, b), (c, d)| (a + c, b + d))
        .unwrap();
    assert_eq!(sum, (totals.insertions, totals.deletions));

    // stage a.txt → 两侧都有 a.txt:staged 侧 +1 -1,wt 侧归零消失
    super::with_repo(t.path(), |r| {
        super::index_ops::stage(r, vec!["a.txt".into()])
    })
    .unwrap();
    let totals = super::with_repo(t.path(), super::diff::totals_of).unwrap();
    let a_rows: Vec<_> = totals.files.iter().filter(|f| f.path == "a.txt").collect();
    assert_eq!(a_rows.len(), 1);
    assert_eq!(
        (a_rows[0].staged, a_rows[0].insertions, a_rows[0].deletions),
        (true, 1, 1)
    );
}

#[test]
fn status_rename_carries_old_path() {
    // rename 条目以新路径为 key、旧路径放 old_path(libgit2 status entry 原生以旧路径为
    // key,若原样透传前端会指向已消失的旧名)。覆盖两侧:index 侧(stage 后)与 workdir 侧。
    let init = |t: &TempRepo| {
        t.write("a.txt", "l1\nl2\nl3\n");
        super::with_repo(t.path(), |r| {
            super::commit::commit(
                r,
                vec!["a.txt".into()],
                super::CommitInput {
                    message: "init".into(),
                    amend: false,
                },
            )
        })
        .unwrap();
        super::evict_cwd(t.path());
    };

    // index 侧:改名后 stage(等价 git add -A)→ head→index 配对,staged rename
    let t = TempRepo::new();
    init(&t);
    std::fs::rename(t.dir.join("a.txt"), t.dir.join("b.txt")).unwrap();
    super::with_repo(t.path(), |r| {
        super::index_ops::stage(r, vec!["a.txt".into(), "b.txt".into()])
    })
    .unwrap();
    super::evict_cwd(t.path());
    let st = super::with_repo(t.path(), super::status::compute).unwrap();
    assert_eq!(st.files.len(), 1);
    let b = &st.files[0];
    assert_eq!(
        (b.path.as_str(), b.status.as_str(), b.staged),
        ("b.txt", "R", true)
    );
    assert_eq!(b.old_path.as_deref(), Some("a.txt"));

    // workdir 侧:纯改名不 stage → 仍配对为 R,但挂在 wt 轨,路径同样换挂新名
    let t2 = TempRepo::new();
    init(&t2);
    std::fs::rename(t2.dir.join("a.txt"), t2.dir.join("b.txt")).unwrap();
    let st = super::with_repo(t2.path(), super::status::compute).unwrap();
    assert_eq!(st.files.len(), 1);
    let b = &st.files[0];
    assert_eq!(
        (b.path.as_str(), b.status.as_str(), b.wt),
        ("b.txt", "R", true)
    );
    assert!(!b.staged);
    assert_eq!(b.old_path.as_deref(), Some("a.txt"));

    // 非 rename 文件不带 old_path
    t2.write("c.txt", "new\n");
    let st = super::with_repo(t2.path(), super::status::compute).unwrap();
    let c = st.files.iter().find(|f| f.path == "c.txt").unwrap();
    assert!(c.old_path.is_none());
}
