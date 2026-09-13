//! clean 契约测试(删除未跟踪文件)—— 从 tests_write_ops.rs 拆出(文件规模铁则)。
//! clean 语义:只吃 untracked;混入 tracked 路径整体拒绝(先校验后删);
//! 盘上已消失的路径幂等跳过;已跟踪文件(哪怕工作区脏)绝不触碰。

use super::tests_common::TempRepo;

#[test]
fn clean_删除_untracked_且绝不碰_已跟踪() {
    let t = TempRepo::new();
    t.write("a.txt", "base\n");
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

    // 两个 untracked + 一个已跟踪(tracked)共存
    t.write("u1.txt", "bye\n");
    t.write("u2.txt", "bye2\n");
    t.write("a.txt", "tracked+dirty\n");

    // 混入 tracked 路径 → 整体拒绝,先校验后删,一个文件都不许少
    let e = String::from(
        super::with_repo(t.path(), |r| {
            super::index_ops::clean(r, vec!["u1.txt".into(), "a.txt".into(), "u2.txt".into()])
        })
        .unwrap_err(),
    );
    assert!(
        e.starts_with("E_EMPTY:"),
        "clean 撞 tracked 应走 E_EMPTY,得: {e}"
    );
    assert!(t.dir.join("u1.txt").exists(), "拒绝时不得删除任何文件");

    // 纯 untracked(含盘上已消失的幽灵路径)→ 全部清掉,tracked 原样
    super::with_repo(t.path(), |r| {
        super::index_ops::clean(
            r,
            vec!["u1.txt".into(), "u2.txt".into(), "ghost.txt".into()],
        )
    })
    .unwrap();
    super::evict_cwd(t.path());
    assert!(!t.dir.join("u1.txt").exists(), "untracked u1 应被删除");
    assert!(!t.dir.join("u2.txt").exists(), "untracked u2 应被删除");
    assert_eq!(
        std::fs::read_to_string(t.dir.join("a.txt")).unwrap(),
        "tracked+dirty\n",
        "已跟踪文件(哪怕工作区脏)绝不被 clean 触碰"
    );

    // 空 paths → E_EMPTY(与 stage/unstage/discard 同一口径)
    let e = String::from(
        super::with_repo(t.path(), |r| super::index_ops::clean(r, vec![])).unwrap_err(),
    );
    assert!(e.starts_with("E_EMPTY:"), "空 paths 应走 E_EMPTY,得: {e}");
}

#[test]
fn clean_拒绝符号链接逃逸与_git_元数据() {
    let t = TempRepo::new();
    t.write("a.txt", "base\n");
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

    // 仓外哨兵文件 + 仓内指向其父目录的 symlink
    let outside_dir = t.dir.parent().unwrap().join("clean-escape-sentry");
    std::fs::create_dir_all(&outside_dir).unwrap();
    let outside = outside_dir.join("sentry.txt");
    std::fs::write(&outside, "keep\n").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside_dir, t.dir.join("esc")).unwrap();

    // 中间符号链接分量逃逸:整体拒绝,哨兵原样
    let e = String::from(
        super::with_repo(t.path(), |r| {
            super::index_ops::clean(r, vec!["esc/sentry.txt".into()])
        })
        .unwrap_err(),
    );
    assert!(
        e.starts_with("E_EMPTY:"),
        "symlink 逃逸应走 E_EMPTY,得: {e}"
    );
    assert_eq!(
        std::fs::read_to_string(&outside).unwrap(),
        "keep\n",
        "仓外文件不得被删"
    );

    // .git/** 是合法仓相对路径但永不在 index:必须显式拒绝
    let e = String::from(
        super::with_repo(t.path(), |r| {
            super::index_ops::clean(r, vec![".git/HEAD".into()])
        })
        .unwrap_err(),
    );
    assert!(e.starts_with("E_EMPTY:"), ".git 应走 E_EMPTY,得: {e}");
    assert!(t.dir.join(".git/HEAD").exists(), "仓库元数据不得被删");

    // symlink 本体(仓内叶节点)仍可正常删除 —— 防线不误伤合法 clean
    super::with_repo(t.path(), |r| super::index_ops::clean(r, vec!["esc".into()])).unwrap();
    assert!(
        std::fs::symlink_metadata(t.dir.join("esc")).is_err(),
        "仓内 symlink 本体应被删除"
    );
    assert_eq!(std::fs::read_to_string(&outside).unwrap(), "keep\n");
}
