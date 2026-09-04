//! git 模块集成测试 —— tempdir 建真实 repo,覆盖 happy path 全链路。
//! 不引 tempfile:std::env::temp_dir + 进程/时间戳构造唯一目录,Drop 清理。

use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};

static SEQ: AtomicU64 = AtomicU64::new(0);

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
fn branch_lifecycle() {
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

    // 创建 + 列表
    super::with_repo(t.path(), |r| super::branch_ops::create(r, "feat/x", None)).unwrap();
    super::evict_cwd(t.path());
    let list = super::with_repo(t.path(), super::branch_ops::list_all).unwrap();
    let names: Vec<&str> = list.local.iter().map(|b| b.name.as_str()).collect();
    assert!(names.contains(&"feat/x"));
    assert!(names.contains(&"master"));
    let master = list.local.iter().find(|b| b.name == "master").unwrap();
    assert!(master.is_head);

    // checkout
    super::with_repo(t.path(), |r| super::branch_ops::checkout(r, "feat/x")).unwrap();
    super::evict_cwd(t.path());
    let st = super::with_repo(t.path(), super::status::compute).unwrap();
    assert_eq!(st.branch, "feat/x");

    // 当前分支不可删
    let err =
        super::with_repo(t.path(), |r| super::branch_ops::delete(r, "feat/x", true)).unwrap_err();
    assert!(String::from(err).starts_with("E_EMPTY:"));

    // 未合并分支拒绝非 force 删除
    t.write("b.txt", "only-on-feat");
    super::with_repo(t.path(), |r| {
        super::commit::commit(
            r,
            vec!["b.txt".into()],
            super::CommitInput {
                message: "feat work".into(),
                amend: false,
            },
        )
    })
    .unwrap();
    super::evict_cwd(t.path());
    super::with_repo(t.path(), |r| super::branch_ops::checkout(r, "master")).unwrap();
    super::evict_cwd(t.path());
    let err =
        super::with_repo(t.path(), |r| super::branch_ops::delete(r, "feat/x", false)).unwrap_err();
    assert!(String::from(err).starts_with("E_EMPTY:"));
    super::with_repo(t.path(), |r| super::branch_ops::delete(r, "feat/x", true)).unwrap();
}

#[test]
fn log_pagination() {
    let t = TempRepo::new();
    for i in 0..5 {
        t.write("a.txt", &format!("v{i}"));
        super::with_repo(t.path(), |r| {
            super::commit::commit(
                r,
                vec!["a.txt".into()],
                super::CommitInput {
                    message: format!("c{i}"),
                    amend: false,
                },
            )
        })
        .unwrap();
        super::evict_cwd(t.path());
    }
    let page1 = super::with_repo(t.path(), |r| super::log::walk(r, 2, 0)).unwrap();
    let page2 = super::with_repo(t.path(), |r| super::log::walk(r, 2, 2)).unwrap();
    assert_eq!(page1.len(), 2);
    assert_eq!(page2.len(), 2);
    // 同秒创建的 commit 在 TIME 排序下平手,顺序不稳定 ——
    // 断言两页不相交且覆盖 4 个不同 commit,而非具体次序。
    let s1: Vec<&str> = page1.iter().map(|e| e.long_sha.as_str()).collect();
    let s2: Vec<&str> = page2.iter().map(|e| e.long_sha.as_str()).collect();
    assert!(s1.iter().all(|s| !s2.contains(s)));
    assert!(page1[0].author_when >= page1[1].author_when);
}

#[test]
fn not_a_repo_error_prefix() {
    let seq = SEQ.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("tmd-git-norepo-{}-{seq}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    let err = super::with_repo(dir.to_str().unwrap(), |_r| Ok(())).unwrap_err();
    assert!(String::from(err).starts_with("E_NOT_A_REPO:"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn remote_push_local_bare_repo() {
    // 本地 bare 仓库当 remote(file:// 无凭据):push 成功路径
    let bare_seq = SEQ.fetch_add(1, Ordering::SeqCst);
    let bare_dir =
        std::env::temp_dir().join(format!("tmd-git-bare-{}-{bare_seq}", std::process::id()));
    let _ = fs::remove_dir_all(&bare_dir);
    git2::Repository::init_bare(&bare_dir).unwrap();

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

    // 配 remote 并 push
    super::with_repo(t.path(), |r| {
        r.remote("origin", bare_dir.to_str().unwrap())?;
        Ok(())
    })
    .unwrap();
    let out = super::with_repo(t.path(), |r| {
        super::remote_ops::run(
            r,
            t.path(),
            super::remote_ops::RemoteOp::Push,
            Some("master".into()),
        )
    });
    assert!(out.is_ok(), "push 失败: {:?}", out.err());

    // fetch 同路径
    let out = super::with_repo(t.path(), |r| {
        super::remote_ops::run(r, t.path(), super::remote_ops::RemoteOp::Fetch, None)
    });
    assert!(out.is_ok(), "fetch 失败: {:?}", out.err());

    let _ = fs::remove_dir_all(&bare_dir);
}

#[test]
fn remote_auth_failure_fast_no_hang() {
    // 不可达 SSH 主机 + BatchMode:必须快速失败,且错误带 E_ 前缀(不挂死)
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
    super::with_repo(t.path(), |r| {
        r.remote("origin", "ssh://git@127.0.0.1:1/x/y.git")?; // 127.0.0.1:1 立即 connection refused
        Ok(())
    })
    .unwrap();

    let start = std::time::Instant::now();
    let err = super::with_repo(t.path(), |r| {
        super::remote_ops::run(
            r,
            t.path(),
            super::remote_ops::RemoteOp::Push,
            Some("master".into()),
        )
    })
    .unwrap_err();
    let elapsed = start.elapsed();
    let msg = String::from(err);
    assert!(
        msg.starts_with("E_AUTH:") || msg.starts_with("E_SHELL:"),
        "错误前缀缺失: {msg}"
    );
    assert!(
        elapsed < std::time::Duration::from_secs(30),
        "挂死风险: {elapsed:?}"
    );
}

#[test]
fn unborn_head_full_flow() {
    // 空仓库(零 commit):status 正常列出 untracked;log 空;首个 commit 直达
    let t = TempRepo::new();
    t.write("new.txt", "hello");
    let st = super::with_repo(t.path(), super::status::compute).unwrap();
    assert_eq!(st.branch, "master"); // HEAD symbolic ref
    assert_eq!(st.head_sha, "");
    assert_eq!(st.files.len(), 1);
    assert_eq!(
        (st.files[0].status.as_str(), st.files[0].staged),
        ("?", false)
    );

    let entries = super::with_repo(t.path(), |r| super::log::walk(r, 10, 0)).unwrap();
    assert!(entries.is_empty());

    // 勾选提交直达首个 commit
    let sha = super::with_repo(t.path(), |r| {
        super::commit::commit(
            r,
            vec!["new.txt".into()],
            super::CommitInput {
                message: "init".into(),
                amend: false,
            },
        )
    })
    .unwrap();
    assert_eq!(sha.len(), 40);

    // amend 在 unborn 上的反向断言已由 commit.rs (true,None) 防线覆盖;
    // unstage unborn 防线:
    let t2 = TempRepo::new();
    let err = super::with_repo(t2.path(), |r| {
        super::index_ops::unstage(r, vec!["x".into()])
    })
    .unwrap_err();
    assert!(String::from(err).starts_with("E_EMPTY:"));
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
