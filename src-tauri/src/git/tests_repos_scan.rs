//! repos_scan 契约测试 —— 多仓发现原语(spec 2026-09-07-git-multi-repo-design §1)。
//! submodule/worktree 用 git 标准磁盘布局手搭(gitdir 指针文件 + .gitmodules),
//! 不依赖 git CLI 与网络;root 自身是仓时排首位;32 上限截断。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use super::tests_common::TempRepo;

static SEQ: AtomicU64 = AtomicU64::new(0);

/// 非仓临时根(发现场景:root 自身不是仓库)。
struct TempRoot {
    dir: PathBuf,
}

impl TempRoot {
    fn new() -> Self {
        let seq = SEQ.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("tmd-scan-{}-{seq}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Self { dir }
    }

    fn mkdir(&self, rel: &str) -> PathBuf {
        let p = self.dir.join(rel);
        fs::create_dir_all(&p).unwrap();
        p
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

/// git2 init + 首个 commit,返回 sha(branch 落地,可断言 shorthand)。
fn init_repo_with_commit(dir: &Path) -> String {
    let repo = git2::Repository::init(dir).unwrap();
    let mut cfg = repo.config().unwrap();
    cfg.set_str("user.name", "t").unwrap();
    cfg.set_str("user.email", "t@t").unwrap();
    fs::write(dir.join("a.txt"), "v1").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("a.txt")).unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    let sig = repo.signature().unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
        .unwrap()
        .to_string()
}

/// 手搭「.git 文件 → gitdir 指针」的仓(main 的 submodule/worktree 布局):
/// target 需是可 open 的 gitdir(HEAD + objects + refs)。
fn link_git_file(work_dir: &Path, gitdir: &Path) {
    fs::write(
        work_dir.join(".git"),
        format!("gitdir: {}\n", gitdir.display()),
    )
    .unwrap();
    fs::create_dir_all(gitdir.join("objects")).unwrap();
    fs::create_dir_all(gitdir.join("refs/heads")).unwrap();
    fs::write(gitdir.join("HEAD"), "ref: refs/heads/master\n").unwrap();
}

#[test]
fn root_repo_first_and_branch() {
    let t = TempRepo::new();
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

    let out = super::repos_scan::scan(t.path(), 2).unwrap();
    assert!(!out.truncated);
    assert_eq!(out.repos.len(), 1);
    let r = &out.repos[0];
    assert_eq!(r.kind, "repo");
    assert_eq!(r.name, t.dir.file_name().unwrap().to_str().unwrap());
    assert!(!r.branch.is_empty(), "已提交仓 branch 取 HEAD shorthand");

    // detached HEAD → branch 空串
    let oid = git2::Oid::from_str(&sha).unwrap();
    git2::Repository::open(&t.dir)
        .unwrap()
        .set_head_detached(oid)
        .unwrap();
    let out = super::repos_scan::scan(t.path(), 2).unwrap();
    assert_eq!(out.repos[0].branch, "");
}

#[test]
fn nested_discovery_depth_cutoff() {
    let root = TempRoot::new();
    init_repo_with_commit(&root.mkdir("a"));
    init_repo_with_commit(&root.mkdir("b/c"));

    let out = super::repos_scan::scan(root.dir.to_str().unwrap(), 1).unwrap();
    assert_eq!(out.repos.len(), 1);
    assert!(out.repos[0].path.ends_with("a"));

    let out = super::repos_scan::scan(root.dir.to_str().unwrap(), 2).unwrap();
    assert_eq!(out.repos.len(), 2);
    // path 排序;a 在 b/c 前
    assert!(out.repos[0].path.ends_with("a"));
    assert!(out.repos[1].path.ends_with("c"));
}

#[test]
fn submodule_and_worktree_kinds() {
    let t = TempRepo::new();
    init_repo_with_commit(&t.dir);
    // submodule:.gitmodules 命中 + .git 文件指向 .git/modules/sub
    fs::write(
        t.dir.join(".gitmodules"),
        "[submodule \"sub\"]\n\tpath = sub\n\turl = https://example.com/x.git\n",
    )
    .unwrap();
    let sub = t.dir.join("sub");
    fs::create_dir_all(&sub).unwrap();
    link_git_file(&sub, &t.dir.join(".git").join("modules").join("sub"));
    // worktree:同款 .git 文件但 .gitmodules 未登记
    let wt = t.dir.join("wt");
    fs::create_dir_all(&wt).unwrap();
    let wt_dir = t.dir.join(".git").join("worktrees").join("wt");
    fs::create_dir_all(&wt_dir).unwrap();
    fs::write(wt_dir.join("commondir"), "../..\n").unwrap();
    fs::write(
        wt_dir.join("gitdir"),
        format!("{}\n", wt.join(".git").display()),
    )
    .unwrap();
    link_git_file(&wt, &wt_dir);

    let out = super::repos_scan::scan(t.path(), 2).unwrap();
    assert_eq!(out.repos.len(), 3);
    assert_eq!(out.repos[0].kind, "repo");
    assert_eq!(out.repos[1].kind, "submodule", "sub;.gitmodules 登记路径");
    assert_eq!(out.repos[2].kind, "worktree", "wt;.git 文件但未登记");
}

#[test]
fn invalid_pointer_skipped() {
    let root = TempRoot::new();
    let broken = root.mkdir("broken");
    fs::write(broken.join(".git"), "gitdir: /definitely/not/here\n").unwrap();
    // .git 目录但内容非法(非仓库)同样防误报跳过
    let fake = root.mkdir("fake");
    fs::create_dir_all(fake.join(".git")).unwrap();

    let out = super::repos_scan::scan(root.dir.to_str().unwrap(), 2).unwrap();
    assert_eq!(out.repos.len(), 0);
    assert!(!out.truncated);
}

#[test]
fn cap_32_truncated() {
    let root = TempRoot::new();
    for i in 0..40 {
        init_repo_with_commit(&root.mkdir(&format!("r{i:02}")));
    }
    let out = super::repos_scan::scan(root.dir.to_str().unwrap(), 2).unwrap();
    assert_eq!(out.repos.len(), 32);
    assert!(out.truncated);
    // 截断也保持 path 排序(r00..r31)
    assert!(out.repos[0].path.ends_with("r00"));
    assert!(out.repos[31].path.ends_with("r31"));
}
