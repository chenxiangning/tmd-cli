//! commit_view + log refs 集成测试(历史 Graph 数据面)—— 从 tests.rs 拆出(文件规模铁则)。

use super::tests_common::TempRepo;
use std::fs;

/// 写文件 → stage → commit,返回新提交 sha。
fn commit_file(t: &TempRepo, name: &str, content: &str, msg: &str) -> String {
    t.write(name, content);
    let sha = super::with_repo(t.path(), |r| {
        super::commit::commit(
            r,
            vec![name.into()],
            super::CommitInput {
                message: msg.into(),
                amend: false,
            },
        )
    })
    .unwrap();
    super::evict_cwd(t.path());
    sha
}

#[test]
fn commit_files_list_and_patch() {
    let t = TempRepo::new();
    let first = commit_file(&t, "a.txt", "v1\nline\n", "init");

    // 根提交:对空树,全部按 Added 出
    let files = super::with_repo(t.path(), |r| super::commit_view::files(r, &first)).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(
        (files[0].path.as_str(), files[0].status.as_str()),
        ("a.txt", "A")
    );
    assert_eq!(files[0].additions, 2);

    let second = commit_file(&t, "a.txt", "v2\nline\n", "change a");
    commit_file(&t, "b.txt", "new\n", "add b");
    let files = super::with_repo(t.path(), |r| super::commit_view::files(r, &second)).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(
        (files[0].path.as_str(), files[0].status.as_str()),
        ("a.txt", "M")
    );
    assert_eq!((files[0].additions, files[0].deletions), (1, 1));

    // 单文件 patch:-v1 → +v2;清单外路径 → None
    let patch = super::with_repo(t.path(), |r| {
        super::commit_view::file_patch(r, &second, "a.txt")
    })
    .unwrap()
    .unwrap();
    assert_eq!(patch.kind, "M");
    assert!(patch.patch.contains("-v1"));
    assert!(patch.patch.contains("+v2"));
    let miss = super::with_repo(t.path(), |r| {
        super::commit_view::file_patch(r, &second, "b.txt")
    })
    .unwrap();
    assert!(miss.is_none());
}

#[test]
fn commit_files_detect_rename() {
    let t = TempRepo::new();
    commit_file(&t, "a.txt", "one\ntwo\nthree\nfour\nfive\n", "init");
    t.write("renamed.txt", "one\ntwo\nthree\nfour\nfive\n");
    fs::remove_file(t.dir.join("a.txt")).unwrap();
    let sha = super::with_repo(t.path(), |r| {
        super::commit::commit(
            r,
            vec!["a.txt".into(), "renamed.txt".into()],
            super::CommitInput {
                message: "rename".into(),
                amend: false,
            },
        )
    })
    .unwrap();
    super::evict_cwd(t.path());

    let files = super::with_repo(t.path(), |r| super::commit_view::files(r, &sha)).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].status, "R");
    assert_eq!(files[0].path, "renamed.txt");
    assert_eq!(files[0].old_path.as_deref(), Some("a.txt"));
    // rename 来源路径可查 patch
    let patch = super::with_repo(t.path(), |r| {
        super::commit_view::file_patch(r, &sha, "a.txt")
    })
    .unwrap()
    .unwrap();
    assert_eq!(patch.kind, "R");
}

#[test]
fn log_refs_decoration() {
    let t = TempRepo::new();
    let c1 = commit_file(&t, "a.txt", "v1", "init");
    let c2 = commit_file(&t, "a.txt", "v2", "second");
    super::with_repo(t.path(), |r| {
        super::branch_ops::create(r, "feature", Some(c1.clone()))?;
        let oid = git2::Oid::from_str(&c1)?;
        r.reference("refs/tags/v1", oid, false, "test: tag")?;
        r.reference("refs/remotes/origin/feature", oid, false, "test: remote")?;
        // 附注 tag:target 是 tag 对象 oid,装饰必须 peel 到提交后仍命中
        let tagger = git2::Signature::now("t", "t@t")?;
        let obj = r.find_object(oid, None)?;
        r.tag("v2", &obj, &tagger, "annotated", false)?;
        Ok(())
    })
    .unwrap();

    let log = super::with_repo(t.path(), |r| super::log::walk(r, 10, 0)).unwrap();
    let head = log.iter().find(|e| e.long_sha == c2).unwrap();
    assert!(
        head.refs.iter().any(|s| s == "HEAD -> master"),
        "head refs: {:?}",
        head.refs
    );
    let c1e = log.iter().find(|e| e.long_sha == c1).unwrap();
    for expected in ["feature", "origin/feature", "tag: v1", "tag: v2"] {
        assert!(
            c1e.refs.iter().any(|s| s == expected),
            "c1 refs: {:?}",
            c1e.refs
        );
    }
}
