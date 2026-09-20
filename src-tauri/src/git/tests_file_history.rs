//! file_log + blame 集成测试(文件历史过滤与逐行归属)—— tests_common TempRepo 范式。

use super::tests_common::TempRepo;

/// 写文件 → stage → commit,返回新提交 sha(tests_commit_view 同款)。
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
fn file_log_只含触达该路径的提交() {
    let t = TempRepo::new();
    let s1 = commit_file(&t, "a.txt", "one\n", "add a");
    commit_file(&t, "b.txt", "x\n", "add b");
    let s3 = commit_file(&t, "a.txt", "one\ntwo\n", "edit a");

    let log = super::with_repo(t.path(), |r| super::file_log::walk_file(r, "a.txt", 200)).unwrap();
    assert_eq!(log.len(), 2, "只统计 a.txt 的两次提交");
    assert_eq!(log[0].long_sha, s3, "新→旧");
    assert_eq!(log[1].long_sha, s1);
    assert_eq!(log[0].summary, "edit a");
}

#[test]
fn file_log_limit_截断与不存在路径() {
    let t = TempRepo::new();
    for i in 0..3 {
        commit_file(&t, "a.txt", &format!("{i}\n"), &format!("c{i}"));
    }
    let log = super::with_repo(t.path(), |r| super::file_log::walk_file(r, "a.txt", 2)).unwrap();
    assert_eq!(log.len(), 2);
    assert_eq!(log[0].summary, "c2");

    let none = super::with_repo(t.path(), |r| super::file_log::walk_file(r, "nope.txt", 10));
    assert!(none.unwrap().is_empty(), "路径从未存在 = 空表");
}

#[test]
fn blame_逐行归属与边界() {
    let t = TempRepo::new();
    commit_file(&t, "a.txt", "one\n", "add a");
    commit_file(&t, "a.txt", "one\ntwo\n", "edit a");

    t.write("a.txt", "one\ntwo\nthree\n");
    let _ = super::with_repo(t.path(), |r| {
        super::commit::commit(
            r,
            vec!["a.txt".into()],
            super::CommitInput {
                message: "add three".into(),
                amend: false,
            },
        )
    });
    super::evict_cwd(t.path());

    let lines = super::with_repo(t.path(), |r| super::blame::blame(r, "a.txt")).unwrap();
    assert_eq!(lines.len(), 3);
    assert!(lines
        .iter()
        .enumerate()
        .all(|(i, l)| l.line_no == i as u32 + 1));
    assert_eq!(lines[0].text, "one");
    assert_eq!(lines[0].summary, "add a", "首行仍归属初始提交");
    assert_eq!(lines[1].summary, "edit a");
    assert_eq!(lines[2].summary, "add three");
    // 每行都构成提交切换边界(三行分属三个提交)
    assert!(lines.iter().all(|l| l.boundary));
    assert_eq!(lines[0].author_name, "t");
}

#[test]
fn blame_未跟踪文件报错上抛() {
    let t = TempRepo::new();
    commit_file(&t, "seed.txt", "s\n", "seed");
    t.write("new.txt", "n\n");
    let r = super::with_repo(t.path(), |r| super::blame::blame(r, "new.txt"));
    assert!(
        r.is_err(),
        "HEAD 无此文件:libgit2 报错原样上抛,前端兜底展示"
    );
}
