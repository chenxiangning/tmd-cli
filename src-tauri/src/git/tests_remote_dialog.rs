//! 远端对话框层测试 —— pull/push/fetch 参数拼装矩阵 + 推送预览 revwalk。
//! 参数拼装不碰网络;预览用手造 refs(不开文件传输),保持毫秒级。

use super::remote_ops::{
    fetch_request_args, gerrit_suffix, pull_request_args, push_preview, push_request_args, remotes,
    GerritExtra, RemoteRequest,
};
use super::tests_common::TempRepo;

fn pull_req(
    remote: Option<&str>,
    branch: Option<&str>,
    strategy: Option<&str>,
    no_commit: bool,
    no_verify: bool,
) -> RemoteRequest {
    RemoteRequest {
        op: "pull".into(),
        remote: remote.map(str::to_string),
        branch: branch.map(str::to_string),
        strategy: strategy.map(str::to_string),
        no_commit,
        no_verify,
        force_with_lease: false,
        follow_tags: false,
        gerrit: None,
    }
}

fn push_req(gerrit: Option<GerritExtra>) -> RemoteRequest {
    RemoteRequest {
        op: "push".into(),
        remote: Some("origin".into()),
        branch: Some("main".into()),
        strategy: None,
        no_commit: false,
        no_verify: false,
        force_with_lease: false,
        follow_tags: false,
        gerrit,
    }
}

#[test]
fn pull_args_matrix() {
    // 逐字对应 codemoss 语义:选项在前,remote/branch 齐全时都带上
    assert_eq!(
        pull_request_args(&pull_req(Some("origin"), Some("main"), None, false, false)).unwrap(),
        vec!["pull", "origin", "main"]
    );
    assert_eq!(
        pull_request_args(&pull_req(
            Some("upstream"),
            Some("dev"),
            Some("--rebase"),
            true,
            true
        ))
        .unwrap(),
        vec![
            "pull",
            "--rebase",
            "--no-commit",
            "--no-verify",
            "upstream",
            "dev"
        ]
    );
    // 全空 = 裸 pull(尊重仓库/用户配置)
    assert_eq!(
        pull_request_args(&pull_req(None, None, None, false, false)).unwrap(),
        vec!["pull"]
    );
    // 非法策略拒绝,不落 shell
    let e = pull_request_args(&pull_req(
        Some("origin"),
        Some("main"),
        Some("--force"),
        false,
        false,
    ))
    .unwrap_err();
    assert!(e.to_string().starts_with("E_EMPTY:"), "{e}");
}

#[test]
fn fetch_args_scope() {
    assert_eq!(
        fetch_request_args(None).unwrap(),
        vec!["fetch", "--all", "--prune"]
    );
    assert_eq!(
        fetch_request_args(Some("up".into())).unwrap(),
        vec!["fetch", "up"]
    );
    // 参数注入防线:以 - 开头一律拒绝
    assert!(fetch_request_args(Some("-x".into())).is_err());
}

#[test]
fn push_args_flags_order_and_new_branch_upstream() {
    let t = TempRepo::new();
    super::with_repo(t.path(), |r| {
        // 无 upstream 的仓库:-u 建跟踪(保持面板直推语义)
        let args = push_request_args(r, &push_req(None)).unwrap();
        assert_eq!(args, vec!["push", "origin", "-u", "HEAD:main"]);
        // 旗标在 remote 前,顺序固定
        let mut req = push_req(None);
        req.no_verify = true;
        req.force_with_lease = true;
        req.follow_tags = true;
        let args = push_request_args(r, &req).unwrap();
        assert_eq!(
            args,
            vec![
                "push",
                "--no-verify",
                "--force-with-lease",
                "--follow-tags",
                "origin",
                "-u",
                "HEAD:main"
            ]
        );
        // 目标分支缺失拒绝
        let mut req = push_req(None);
        req.branch = None;
        assert!(push_request_args(r, &req).is_err());
        Ok(())
    })
    .unwrap();
}

#[test]
fn push_args_gerrit_refspec() {
    let t = TempRepo::new();
    super::with_repo(t.path(), |r| {
        let g = GerritExtra {
            topic: Some("t1".into()),
            reviewers: Some("u1, u2".into()),
            cc: Some("c1".into()),
        };
        let args = push_request_args(r, &push_req(Some(g))).unwrap();
        assert_eq!(
            args.last().unwrap(),
            "HEAD:refs/for/main%topic=t1,r=u1,r=u2,cc=c1"
        );
        // Gerrit 推送不补 -u(refs/for 不是分支)
        assert!(!args.contains(&"-u".to_string()));
        Ok(())
    })
    .unwrap();
}

#[test]
fn gerrit_suffix_skips_blanks() {
    let g = GerritExtra {
        topic: Some("  ".into()),
        reviewers: Some(",u1,".into()),
        cc: None,
    };
    assert_eq!(gerrit_suffix(&g), "r=u1");
}

/// 手造 origin/master 追踪引用 → 预览=target 之后的独有提交;引用缺失=新分支态。
#[test]
fn push_preview_revwalk_and_remotes() {
    let t = TempRepo::new();
    let mut shas = Vec::new();
    for i in 0..3 {
        t.write(&format!("f{i}.txt"), &format!("v{i}\n"));
        let sha = super::with_repo(t.path(), |r| {
            super::commit::commit(
                r,
                vec![format!("f{i}.txt")],
                super::CommitInput {
                    message: format!("c{i}"),
                    amend: false,
                },
            )
        })
        .unwrap();
        shas.push(sha);
    }
    super::evict_cwd(t.path());

    super::with_repo(t.path(), |r| {
        // 无远端配置:remotes 空;注册 origin 后可见
        assert!(remotes(r).unwrap().is_empty());
        r.remote("origin", "/tmp/unused-url").unwrap();
        assert_eq!(remotes(r).unwrap(), vec!["origin"]);

        // 目标引用不存在 = 新分支首推:全部分支提交,target_found=false
        let p = push_preview(r, "origin", "feature", 120).unwrap();
        assert!(!p.target_found);
        assert_eq!(p.commits.len(), 3);
        assert!(!p.has_more);
        assert_eq!(p.source_branch, "master");

        // 造 origin/master → 指向最早提交:预览 = 其后的 2 条
        let old = git2::Oid::from_str(&shas[0]).unwrap();
        r.reference("refs/remotes/origin/master", old, true, "test")
            .unwrap();
        let p = push_preview(r, "origin", "master", 120).unwrap();
        assert!(p.target_found);
        assert_eq!(p.commits.len(), 2);
        assert_eq!(p.commits[0].long_sha, shas[2]);
        assert_eq!(p.commits[1].long_sha, shas[1]);

        // limit 截断:hasMore 如实
        let p = push_preview(r, "origin", "master", 1).unwrap();
        assert_eq!(p.commits.len(), 1);
        assert!(p.has_more);
        Ok(())
    })
    .unwrap();
}
