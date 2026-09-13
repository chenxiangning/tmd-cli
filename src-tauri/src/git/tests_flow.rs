//! git 模块集成测试(分支/日志/远端/unborn 生命周期)—— 自 tests.rs 拆出(文件规模铁则)。
//! status/diff 契约测试留在 tests.rs;共享 TempRepo 见 tests_common.rs。

use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};

use super::tests_common::TempRepo;

static SEQ: AtomicU64 = AtomicU64::new(0);

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

/// divergent 场景构造:本地仓 t + bare 远端 + 「另一台机器」克隆 w。
/// 基线 init 提交 push 后,双方各得一个提交(改名即无冲突,同名同位必冲突)。
fn setup_divergent(local: (&str, &str), remote: (&str, &str)) -> (TempRepo, std::path::PathBuf) {
    let seq = SEQ.fetch_add(1, Ordering::SeqCst);
    let bare = std::env::temp_dir().join(format!("tmd-git-bare-{}-{seq}", std::process::id()));
    let _ = fs::remove_dir_all(&bare);
    git2::Repository::init_bare(&bare).unwrap();

    let t = TempRepo::new();
    t.write("base.txt", "base");
    super::with_repo(t.path(), |r| {
        super::commit::commit(
            r,
            vec!["base.txt".into()],
            super::CommitInput {
                message: "init".into(),
                amend: false,
            },
        )
    })
    .unwrap();
    super::evict_cwd(t.path());
    super::with_repo(t.path(), |r| {
        r.remote("origin", bare.to_str().unwrap())?;
        Ok(())
    })
    .unwrap();
    super::with_repo(t.path(), |r| {
        super::remote_ops::run(
            r,
            t.path(),
            super::remote_ops::RemoteOp::Push,
            Some("master".into()),
        )
    })
    .unwrap();

    // 远端工作克隆:提交远端提交并 push
    let w = std::env::temp_dir().join(format!("tmd-git-peer-{}-{seq}", std::process::id()));
    let _ = fs::remove_dir_all(&w);
    git_cli(
        t.dir.parent().unwrap(),
        &["clone", bare.to_str().unwrap(), w.to_str().unwrap()],
    );
    fs::write(w.join(remote.0), remote.1).unwrap();
    git_cli(&w, &["add", "-A"]);
    git_cli(&w, &["commit", "-m", "remote"]);
    git_cli(&w, &["push"]);

    // 本地提交(不 pull,构造 divergent)
    t.write(local.0, local.1);
    super::with_repo(t.path(), |r| {
        super::commit::commit(
            r,
            vec![local.0.into()],
            super::CommitInput {
                message: "local".into(),
                amend: false,
            },
        )
    })
    .unwrap();
    super::evict_cwd(t.path());
    (t, w)
}

/// 测试用 git CLI(签名走 -c,不依赖全局配置)。
fn git_cli(cwd: &std::path::Path, args: &[&str]) {
    let st = std::process::Command::new("git")
        .args(["-c", "user.name=t", "-c", "user.email=t@t"])
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .status()
        .unwrap();
    assert!(st.success(), "git {args:?} 失败");
}

#[test]
fn pull_divergent_无冲突_自动rebase完成更新() {
    let (t, w) = setup_divergent(("local.txt", "local\n"), ("remote.txt", "remote\n"));
    let out = super::with_repo(t.path(), |r| {
        super::remote_ops::run(
            r,
            t.path(),
            super::remote_ops::RemoteOp::Pull,
            Some("master".into()),
        )
    });
    assert!(out.is_ok(), "divergent 无冲突应兜底成功: {:?}", out.err());
    super::evict_cwd(t.path());
    // 本地提交重放到远端提交之后:HEAD=local → parent=remote → parent=init
    super::with_repo(t.path(), |r| {
        let head = r.head()?.peel_to_commit()?;
        let parent = head.parent(0)?;
        let grand = parent.parent(0)?;
        assert_eq!(head.summary(), Some("local"));
        assert_eq!(parent.summary(), Some("remote"));
        assert_eq!(grand.summary(), Some("init"));
        Ok(())
    })
    .unwrap();
    let _ = fs::remove_dir_all(&w);
}

#[test]
fn pull_divergent_有冲突_中止恢复原状并报错() {
    let (t, w) = setup_divergent(("same.txt", "local\n"), ("same.txt", "remote\n"));
    let err = super::with_repo(t.path(), |r| {
        super::remote_ops::run(
            r,
            t.path(),
            super::remote_ops::RemoteOp::Pull,
            Some("master".into()),
        )
    })
    .unwrap_err();
    let msg = String::from(err);
    assert!(msg.contains("拉取有冲突"), "应报冲突: {msg}");
    super::evict_cwd(t.path());
    // rebase --abort 生效:HEAD 回本地提交,工作区干净,无 rebase 中间态
    assert!(!t.dir.join(".git/rebase-merge").exists());
    super::with_repo(t.path(), |r| {
        assert_eq!(r.head()?.peel_to_commit()?.summary(), Some("local"));
        Ok(())
    })
    .unwrap();
    let st = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(t.path())
        .output()
        .unwrap();
    assert!(
        st.stdout.is_empty(),
        "工作区应干净: {:?}",
        String::from_utf8_lossy(&st.stdout)
    );
    let _ = fs::remove_dir_all(&w);
}

#[test]
fn pull_divergent_未提交改动_拒绝且工作区原样() {
    // 大仙关注的防线:未提交的本地改动绝不能被兜底 rebase 冲掉。
    // git 对 pull --rebase + unstaged changes 直接拒绝,错误原样透传。
    let (t, w) = setup_divergent(("local.txt", "local\n"), ("remote.txt", "remote\n"));
    t.write("base.txt", "dirty");
    let err = super::with_repo(t.path(), |r| {
        super::remote_ops::run(
            r,
            t.path(),
            super::remote_ops::RemoteOp::Pull,
            Some("master".into()),
        )
    })
    .unwrap_err();
    let msg = String::from(err);
    assert!(
        msg.contains("unstaged changes"),
        "应透传 git 的拒绝而非硬拉: {msg}"
    );
    super::evict_cwd(t.path());
    assert_eq!(fs::read_to_string(t.dir.join("base.txt")).unwrap(), "dirty");
    super::with_repo(t.path(), |r| {
        assert_eq!(r.head()?.peel_to_commit()?.summary(), Some("local"));
        Ok(())
    })
    .unwrap();
    let _ = fs::remove_dir_all(&w);
}
