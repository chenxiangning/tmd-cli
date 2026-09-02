//! 写操作契约测试(discard / rename)—— 从 tests.rs 拆出(文件规模铁则)。
//! discard 语义:工作区还原到暂存区内容,staged 保留,untracked 绝不动。

use super::tests_common::TempRepo;

#[test]
fn discard_还原到暂存区且绝不碰_untracked() {
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

    // 暂存一版 → 工作区再改一版 → untracked 共存
    t.write("a.txt", "staged\n");
    super::with_repo(t.path(), |r| {
        super::index_ops::stage(r, vec!["a.txt".into()])
    })
    .unwrap();
    super::evict_cwd(t.path());
    t.write("a.txt", "staged+wt\n");
    t.write("c.txt", "keep\n");

    // discard a.txt:工作区回到「暂存后的内容」,不连带清暂存
    super::with_repo(t.path(), |r| {
        super::index_ops::discard(r, vec!["a.txt".into()])
    })
    .unwrap();
    super::evict_cwd(t.path());
    assert_eq!(
        std::fs::read_to_string(t.dir.join("a.txt")).unwrap(),
        "staged\n",
        "discard 后工作区应等于 index(staged 保留)"
    );
    let st = super::with_repo(t.path(), super::status::compute).unwrap();
    let a = st.files.iter().find(|f| f.path == "a.txt").unwrap();
    assert!((a.staged, a.wt) == (true, false), "暂存保留且工作区干净");

    // untracked c.txt 绝不动(checkout_index 只写 index 内条目)
    assert_eq!(
        std::fs::read_to_string(t.dir.join("c.txt")).unwrap(),
        "keep\n",
        "untracked 文件不得被 discard 触碰"
    );
}

#[test]
fn rename_状态与_old_path_全链路() {
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

    // mv:暂存删除 a.txt + 暂存新增同名内容 b.txt
    std::fs::rename(t.dir.join("a.txt"), t.dir.join("b.txt")).unwrap();
    super::with_repo(t.path(), |r| {
        super::index_ops::stage(r, vec!["a.txt".into(), "b.txt".into()])
    })
    .unwrap();
    super::evict_cwd(t.path());

    let st = super::with_repo(t.path(), super::status::compute).unwrap();
    /* libgit2 quirk:head→index 的 rename 在 status 里挂在旧路径 a.txt 上 */
    let a = st.files.iter().find(|f| f.path == "a.txt").unwrap();
    assert_eq!(a.status, "R", "staged rename 应识别为 R");

    // patch 按前端契约(拿 status 的 path 查)取:请求旧路径,经 old_file 匹配命中
    // rename delta,kind=R;锁住 file_patch 不做单文件 pathspec 收窄的回归线。
    let patch = super::with_repo(t.path(), |r| super::diff::file_patch(r, "a.txt", true))
        .unwrap()
        .unwrap();
    assert_eq!(patch.kind, "R");
    assert_eq!(patch.path, "a.txt");
}
