//! smart_checkout / undo 契约测试 —— 自 tests_write_ops.rs 拆出(文件规模铁则)。
//! 干净直切、脏区 stash 恢复、冲突保留 stash、undo 还原;公共前置 repo_with_origin_feat 在 tests_write_ops.rs。

use super::tests_common::TempRepo;
use super::tests_write_ops::repo_with_origin_feat;
/// 公共前置:检出 origin/feat 为本地并推进一提交(a.txt=feat-side),回到默认分支。
fn feat_ahead_and_back() -> (TempRepo, String) {
    let t = repo_with_origin_feat();
    let default_branch =
        super::with_repo(t.path(), |r| Ok(r.head()?.shorthand().unwrap().to_string())).unwrap();
    super::with_repo(t.path(), |r| {
        super::branch_ops::checkout_remote(r, "origin/feat")
    })
    .unwrap();
    t.write("a.txt", "feat-side\n");
    super::with_repo(t.path(), |r| {
        super::commit::commit(
            r,
            vec!["a.txt".into()],
            super::CommitInput {
                message: "feat advance".into(),
                amend: false,
            },
        )
        .map(|_| ())
    })
    .unwrap();
    super::with_repo(t.path(), |r| {
        super::branch_ops::checkout(r, &default_branch)
    })
    .unwrap();
    (t, default_branch)
}

fn stash_count(r: &mut git2::Repository) -> usize {
    let mut n = 0;
    r.stash_foreach(|_, _, _| {
        n += 1;
        true
    })
    .unwrap();
    n
}

#[test]
fn smart_checkout_干净直切_脏暂存恢复() {
    let (t, _default_branch) = feat_ahead_and_back();

    // 干净:直切,无 stash 产生
    super::with_repo_mut(t.path(), |r| {
        super::stash_ops::smart_checkout(r, "feat", false)?;
        assert_eq!(r.head()?.shorthand(), Some("feat"));
        assert_eq!(stash_count(r), 0, "干净工作区不应产生 stash");
        Ok(())
    })
    .unwrap();

    // 脏(untracked,不冲突):stash -u → 切换 → pop 恢复
    super::with_repo(t.path(), |r| super::branch_ops::create(r, "feat2", None)).unwrap();
    t.write("carry.txt", "carry\n");
    super::with_repo_mut(t.path(), |r| {
        super::stash_ops::smart_checkout(r, "feat2", false)?;
        assert_eq!(r.head()?.shorthand(), Some("feat2"));
        assert_eq!(
            std::fs::read_to_string(t.dir.join("carry.txt")).unwrap(),
            "carry\n",
            "untracked 改动应随后切换恢复"
        );
        let st = super::status::compute(r)?;
        assert!(
            st.files.iter().any(|f| f.path == "carry.txt"),
            "恢复后仍为工作区变更"
        );
        assert_eq!(stash_count(r), 0, "pop 成功后 stash 应已丢弃");
        Ok(())
    })
    .unwrap();
}

#[test]
fn smart_checkout_冲突时切换生效且stash保留() {
    let (t, _default_branch) = feat_ahead_and_back();
    // 同文件不同内容:直接携带必冲突,走 stash 路径
    t.write("a.txt", "dirty-local\n");

    let (out, a_txt, n) = super::with_repo_mut(t.path(), |r| {
        let out = super::stash_ops::smart_checkout(r, "feat", false);
        let a = std::fs::read_to_string(t.dir.join("a.txt")).unwrap();
        let n = stash_count(r);
        Ok((out.map(|_| ()).map_err(|e| e.to_string()), a, n))
    })
    .unwrap();

    // libgit2 stash_pop 冲突时也返回 Ok 并丢 stash(实测)—— 这是改用
    // stash_apply + has_conflicts 的原因;契约必须锁死:
    assert!(out.unwrap_err().contains("已切换到 feat"));
    assert!(a_txt.contains("<<<<<<<"), "冲突应已标记在文件中: {a_txt:?}");
    assert_eq!(n, 1, "冲突时 stash 必须保留");
    assert_eq!(
        super::with_repo_mut(t.path(), |r| Ok(r.head()?.shorthand().unwrap().to_string())).unwrap(),
        "feat",
        "切换应已生效"
    );
}
#[test]
fn smart_checkout_undo_回到原分支并恢复改动() {
    let (t, default_branch) = feat_ahead_and_back();
    // 同文件冲突路径:smart 切到 feat 后留下冲突标记与保留的 stash
    t.write("a.txt", "dirty-local\n");
    let e = String::from(
        super::with_repo_mut(t.path(), |r| {
            super::stash_ops::smart_checkout(r, "feat", false)
        })
        .unwrap_err(),
    );
    assert!(e.contains("已切换到 feat"));

    super::with_repo_mut(t.path(), |r| {
        super::stash_ops::undo(r, &default_branch)?;
        assert_eq!(
            r.head()?.shorthand(),
            Some(default_branch.as_str()),
            "undo 应切回原分支"
        );
        assert_eq!(
            std::fs::read_to_string(t.dir.join("a.txt")).unwrap(),
            "dirty-local\n",
            "原改动应从 stash 恢复"
        );
        assert_eq!(stash_count(r), 0, "恢复成功后 stash 应已丢弃");
        let st = super::status::compute(r)?;
        assert!(
            !st.files.iter().any(|f| f.status == "C"),
            "还原后不应残留冲突态"
        );
        Ok(())
    })
    .unwrap();

    // 无 stash 后再 undo → 拒绝(reset 是纯丢弃,没有备份绝不执行)
    let e = String::from(
        super::with_repo_mut(t.path(), |r| super::stash_ops::undo(r, &default_branch)).unwrap_err(),
    );
    assert!(e.contains("无可还原"), "得: {e}");
}
