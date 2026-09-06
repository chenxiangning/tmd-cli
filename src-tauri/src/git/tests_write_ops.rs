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
pub(super) fn repo_with_origin_feat() -> TempRepo {
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
