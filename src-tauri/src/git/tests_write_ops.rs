//! 写操作契约测试(discard / rename / checkout_remote / push 参数)—— 从 tests.rs 拆出(文件规模铁则)。
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
    /* status entry 以新路径 b.txt 为 key(旧路径 a.txt 进 old_path)——
     * libgit2 原生以旧路径为 key,compute 已换挂,前端不指向消失的旧名 */
    let b = st.files.iter().find(|f| f.path == "b.txt").unwrap();
    assert_eq!(b.status, "R", "staged rename 应识别为 R");
    assert_eq!(b.old_path.as_deref(), Some("a.txt"));

    // patch 按前端契约(拿 status 的 path 查):请求新路径命中 rename delta,kind=R;
    // file_patch 双向匹配(new/old_file),旧路径请求也仍命中 —— 两条都是回归线
    // (锁住 file_patch 不做单文件 pathspec 收窄:收窄会拆散 rename 配对)。
    let patch = super::with_repo(t.path(), |r| super::diff::file_patch(r, "b.txt", true))
        .unwrap()
        .unwrap();
    assert_eq!(patch.kind, "R");
    assert_eq!(patch.path, "b.txt");
    assert_eq!(patch.old_path.as_deref(), Some("a.txt"));
    let patch_old = super::with_repo(t.path(), |r| super::diff::file_patch(r, "a.txt", true))
        .unwrap()
        .unwrap();
    assert_eq!(patch_old.kind, "R");
}
/// 公共前置:单提交 repo + 远端引用 origin/feat 指向 HEAD(本地无同名分支)。
fn repo_with_origin_feat() -> TempRepo {
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
    super::with_repo(t.path(), |r| {
        r.remote("origin", "https://example.com/x.git")?;
        let target = r.head()?.peel_to_commit()?;
        r.reference(
            "refs/remotes/origin/feat",
            target.id(),
            true,
            "test remote ref",
        )?;
        Ok(())
    })
    .unwrap();
    t
}

#[test]
fn checkout_remote_建本地分支建跟踪并切换() {
    let t = repo_with_origin_feat();
    super::with_repo(t.path(), |r| {
        super::branch_ops::checkout_remote(r, "origin/feat")
    })
    .unwrap();
    super::evict_cwd(t.path());

    super::with_repo(t.path(), |r| {
        let head = r.head()?;
        assert_eq!(head.shorthand(), Some("feat"), "HEAD 应切到新建本地分支");
        let b = r.find_branch("feat", git2::BranchType::Local)?;
        let up = b.upstream()?;
        assert_eq!(
            up.name()?.map(str::to_string),
            Some("origin/feat".to_string()),
            "本地分支应建跟踪"
        );
        assert_eq!(
            b.get().peel_to_commit()?.id(),
            r.revparse_single("origin/feat")?.peel_to_commit()?.id(),
            "本地分支指向远端同名提交"
        );
        Ok(())
    })
    .unwrap();
}

#[test]
fn checkout_remote_本地同名已存在拒绝() {
    let t = repo_with_origin_feat();
    super::with_repo(t.path(), |r| super::branch_ops::create(r, "feat", None)).unwrap();
    let e = String::from(
        super::with_repo(t.path(), |r| {
            super::branch_ops::checkout_remote(r, "origin/feat")
        })
        .unwrap_err(),
    );
    assert!(e.starts_with("E_EMPTY:"), "已存在应走 E_EMPTY 引导,得: {e}");
}

#[test]
fn push_args_无upstream建跟踪_有upstream显式上游() {
    let t = repo_with_origin_feat();
    super::with_repo(t.path(), |r| {
        // 新分支:无 upstream → 显式 -u 建跟踪
        super::branch_ops::create(r, "fresh", None)?;
        let args = super::remote_ops::push_args(r, "fresh")?;
        assert_eq!(args, vec!["-u", "origin", "fresh"]);
        // 无任何远端配置 → 明确报错而非产出坏参数
        super::branch_ops::create(r, "lonely", None)?;
        r.remote_delete("origin")?;
        let e = String::from(super::remote_ops::push_args(r, "lonely").unwrap_err());
        assert!(e.starts_with("E_EMPTY:"), "无远端应走 E_EMPTY,得: {e}");
        r.remote("origin", "https://example.com/x.git")?;
        // 有 upstream → 显式推到上游同名分支(非当前分支也可推)
        let mut tracked = r.find_branch("fresh", git2::BranchType::Local)?;
        let target = tracked.get().peel_to_commit()?;
        r.reference("refs/remotes/origin/fresh", target.id(), true, "test")?;
        tracked.set_upstream(Some("origin/fresh"))?;
        assert_eq!(
            super::remote_ops::push_args(r, "fresh")?,
            vec!["origin".to_string(), "fresh:fresh".to_string()]
        );
        Ok(())
    })
    .unwrap();
}

#[test]
fn pull_args_当前裸拉_非当前ff_无upstream拒绝() {
    let t = repo_with_origin_feat();
    super::with_repo(t.path(), |r| {
        super::branch_ops::create(r, "fresh", None)?;
        // 当前分支(origin/feat 指向 HEAD,检出 feat 后 HEAD 即 feat)
        super::branch_ops::checkout_remote(r, "origin/feat")?;
        assert_eq!(
            super::remote_ops::pull_args(r, "feat")?,
            Vec::<String>::new(),
            "当前分支裸 pull,尊重 pull.rebase"
        );
        // 非当前分支有 upstream → fetch refspec 仅 fast-forward
        super::branch_ops::create(r, "other", None)?;
        let mut b = r.find_branch("fresh", git2::BranchType::Local)?;
        b.set_upstream(Some("origin/feat"))?;
        assert_eq!(
            super::remote_ops::pull_args(r, "fresh")?,
            vec!["origin".to_string(), "feat:fresh".to_string()],
            "非当前分支返回 refspec 参数,fetch 子命令由 run 层选择"
        );
        // 无 upstream → E_EMPTY
        let e = String::from(super::remote_ops::pull_args(r, "other").unwrap_err());
        assert!(
            e.starts_with("E_EMPTY:"),
            "无 upstream 应走 E_EMPTY,得: {e}"
        );
        Ok(())
    })
    .unwrap();
}

#[test]
fn fetch_args_远程分支与上游引用() {
    let t = repo_with_origin_feat();
    super::with_repo(t.path(), |r| {
        // 远程分支名 → fetch 该远端分支
        assert_eq!(
            super::remote_ops::fetch_args(r, "origin/feat")?,
            vec!["origin".to_string(), "feat".to_string()]
        );
        // 本地分支带 upstream → fetch 其上游引用
        super::branch_ops::create(r, "fresh", None)?;
        let mut b = r.find_branch("fresh", git2::BranchType::Local)?;
        b.set_upstream(Some("origin/feat"))?;
        assert_eq!(
            super::remote_ops::fetch_args(r, "fresh")?,
            vec!["origin".to_string(), "feat".to_string()]
        );
        // 无 upstream → E_EMPTY
        super::branch_ops::create(r, "lonely", None)?;
        let e = String::from(super::remote_ops::fetch_args(r, "lonely").unwrap_err());
        assert!(
            e.starts_with("E_EMPTY:"),
            "无 upstream 应走 E_EMPTY,得: {e}"
        );
        Ok(())
    })
    .unwrap();
}
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
