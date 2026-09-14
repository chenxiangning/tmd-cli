//! git 拉取 divergent 兜底测试(rebase 兜底/冲突中止/未提交防线)—— 自 tests_flow.rs 拆出(文件规模铁则)。

use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};

use super::tests_common::TempRepo;

static SEQ: AtomicU64 = AtomicU64::new(0);

/// divergent 场景构造:本地仓 t + bare 远端 + 「另一台机器」克隆 w。
/// 基线 init 提交 push 后,双方各得一个提交(改名即无冲突,同名同位必冲突)。
fn setup_divergent(local: (&str, &str), remote: (&str, &str)) -> (TempRepo, std::path::PathBuf) {
    let seq = SEQ.fetch_add(1, Ordering::SeqCst);
    let bare = std::env::temp_dir().join(format!("tmd-git-pull-bare-{}-{seq}", std::process::id()));
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
    let w = std::env::temp_dir().join(format!("tmd-git-pull-peer-{}-{seq}", std::process::id()));
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
