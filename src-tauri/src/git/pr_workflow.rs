//! 创建 PR 工作流 —— Precheck→Push→Create PR→Comment 四步编排。
//!
//! mossx commands_pr_workflow 复刻(设计 spec 2026-09-15):预检(gh 可用 +
//! upstream 范围闸门)→ 推送(fork origin)→ 建 PR(已有复用)→ 可选审批评论。
//! 阶段状态经 `git://pr-stage` 实时推给前端四卡;软失败(闸门确认/评论失败)
//! 走 ok=false 结果体,Err 只留给仓库级硬错。类型对齐 kernel/gitContract.ts。

use git2::Repository;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::pr_defaults::{remote_repo, PR_BODY_TEMPLATE};
use super::pr_gate::{self, Decision};
use super::pr_gh;
use super::remote_ops::exec_git;
use super::GitError;

/// 阶段进度事件(kernel/ipc.ts onGitPrStage 订阅)。
pub const STAGE_EVENT: &str = "git://pr-stage";

/* ── 契约类型(serde camelCase,对齐 GitPrRequest/GitPrWorkflowResult)── */

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrRequest {
    pub upstream_repo: String,
    pub base_branch: String,
    pub head_owner: String,
    pub head_branch: String,
    pub title: String,
    pub body: Option<String>,
    pub comment_after_create: bool,
    pub comment_body: Option<String>,
    pub allow_large_range: bool,
    pub confirmed_range_fingerprint: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrStage {
    pub key: String,
    pub status: String,
    pub detail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrConfirmation {
    pub changed_file_count: usize,
    pub fingerprint: String,
    pub diff_incomplete: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrWorkflowResult {
    pub ok: bool,
    pub message: String,
    pub pr_url: Option<String>,
    pub pr_number: Option<u64>,
    pub stages: Vec<PrStage>,
    pub confirmation: Option<PrConfirmation>,
}

/* ── 四步编排 ── */

fn stages_new() -> Vec<PrStage> {
    ["precheck", "push", "createPr", "comment"]
        .iter()
        .map(|k| PrStage {
            key: k.to_string(),
            status: "pending".into(),
            detail: String::new(),
        })
        .collect()
}

fn set_stage(stages: &mut [PrStage], app: &AppHandle, i: usize, status: &str, detail: String) {
    stages[i].status = status.into();
    stages[i].detail = detail;
    let _ = app.emit(STAGE_EVENT, stages.to_vec());
}

/// 定位 upstreamRepo 对应的本地远端名:upstream → origin → 首个同解析仓。
fn resolve_remote_name(repo: &Repository, upstream_repo: &str) -> Result<String, GitError> {
    for name in ["upstream", "origin"] {
        if remote_repo(repo, name).as_deref() == Some(upstream_repo) {
            return Ok(name.into());
        }
    }
    Err(GitError::empty(format!(
        "远端 {upstream_repo} 未配置到本仓(upstream/origin 均未命中),请先 git remote add"
    )))
}

/// 四步工作流主体(with_repo_mut 锁内;软失败返回 ok=false 结果体)。
pub fn run(
    repo: &mut Repository,
    cwd: &str,
    req: PrRequest,
    app: AppHandle,
) -> Result<PrWorkflowResult, GitError> {
    let mut stages = stages_new();
    let finish = |stages: &mut Vec<PrStage>,
                  ok: bool,
                  message: String,
                  confirmation: Option<PrConfirmation>,
                  pr: Option<(String, u64)>| {
        let _ = app.emit(STAGE_EVENT, stages.clone());
        Ok(PrWorkflowResult {
            ok,
            message,
            pr_url: pr.as_ref().map(|(u, _)| u.clone()),
            pr_number: pr.as_ref().map(|(_, n)| *n),
            stages: stages.clone(),
            confirmation,
        })
    };
    fn step_err(e: GitError) -> GitError {
        GitError::shell(format!("预检失败: {e}"))
    }
    pr_gh::precheck(cwd).map_err(step_err)?;
    let remote = resolve_remote_name(repo, &req.upstream_repo).map_err(step_err)?;
    exec_git(
        repo,
        cwd,
        &["fetch".into(), remote.clone(), req.base_branch.clone()],
    )
    .map_err(step_err)?;
    let base_ref = format!("refs/remotes/{remote}/{}", req.base_branch);
    let fp_out = exec_git(
        repo,
        cwd,
        &["rev-parse".into(), base_ref.clone(), "HEAD".into()],
    )
    .map_err(step_err)?;
    let mut lines = fp_out.lines().map(str::trim).filter(|l| !l.is_empty());
    let (Some(b), Some(h)) = (lines.next(), lines.next()) else {
        return Err(GitError::shell("预检失败: rev-parse 输出异常"));
    };
    let fingerprint = format!("{b}...{h}");
    let diff_out = exec_git(
        repo,
        cwd,
        &[
            "diff".into(),
            "--name-only".into(),
            format!("{}/{}...HEAD", remote, req.base_branch),
        ],
    )
    .map_err(step_err)?;
    let changed: Vec<String> = diff_out
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect();
    let authorized =
        req.allow_large_range && req.confirmed_range_fingerprint.as_deref() == Some(&fingerprint);
    match pr_gate::evaluate(&changed, authorized) {
        Ok(Decision::Pass) => {
            let n = changed.len();
            set_stage(
                &mut stages,
                &app,
                0,
                "success",
                format!("预检通过,改动 {n} 个文件。"),
            );
        }
        Ok(Decision::ConfirmationRequired {
            changed_files,
            reason,
            diff_incomplete,
        }) => {
            set_stage(&mut stages, &app, 0, "failed", reason.clone());
            return finish(
                &mut stages,
                false,
                reason,
                Some(PrConfirmation {
                    changed_file_count: changed_files,
                    fingerprint,
                    diff_incomplete,
                }),
                None,
            );
        }
        Err(blocked) => {
            set_stage(&mut stages, &app, 0, "failed", blocked.to_string());
            return finish(&mut stages, false, blocked.to_string(), None, None);
        }
    }

    /* ── Push:推 HEAD 到 fork origin 的 head 分支 ── */
    set_stage(
        &mut stages,
        &app,
        1,
        "running",
        format!("推送 origin/{}…", req.head_branch),
    );
    match exec_git(
        repo,
        cwd,
        &[
            "push".into(),
            "-u".into(),
            "origin".into(),
            format!("HEAD:{}", req.head_branch),
        ],
    ) {
        Ok(_) => set_stage(&mut stages, &app, 1, "success", "分支推送完成。".into()),
        Err(e) => {
            let msg = format!("推送失败: {e}");
            set_stage(&mut stages, &app, 1, "failed", msg.clone());
            return finish(&mut stages, false, msg, None, None);
        }
    }

    /* ── Create PR:已有复用,否则 gh pr create ── */
    set_stage(&mut stages, &app, 2, "running", "创建 PR…".into());
    let head_full = format!("{}:{}", req.head_owner, req.head_branch);
    let body = req
        .body
        .clone()
        .filter(|b| !b.trim().is_empty())
        .or_else(|| {
            Some(
                PR_BODY_TEMPLATE
                    .replace("{base}", &req.base_branch)
                    .replace("{head}", &req.head_branch),
            )
        });
    let pr = pr_gh::ensure_pr(
        cwd,
        &req.upstream_repo,
        &req.base_branch,
        &head_full,
        &req.title,
        body,
    );
    let Some((pr_url, mut pr_number)) = pr else {
        let msg = "创建 PR 失败:gh 未返回 PR 地址,请到终端执行 gh pr view 核对。".to_string();
        set_stage(&mut stages, &app, 2, "failed", msg.clone());
        return finish(&mut stages, false, msg, None, None);
    };
    let reused = pr_number > 0;
    if pr_number == 0 {
        if let Some(n) = pr_gh::parse_pr_number(&pr_url) {
            pr_number = n;
        }
    }
    let state_word = if reused {
        "已存在同名 PR,复用"
    } else {
        "PR 已创建"
    };
    set_stage(
        &mut stages,
        &app,
        2,
        "success",
        format!("{state_word}: {pr_url}"),
    );

    let comment_body = req.comment_body.unwrap_or_default();
    if reused || !req.comment_after_create || comment_body.trim().is_empty() {
        set_stage(&mut stages, &app, 3, "skipped", "跳过评论。".into());
    } else if pr_number > 0 {
        let n = pr_number;
        set_stage(&mut stages, &app, 3, "running", format!("评论 PR #{n}…"));
        match pr_gh::comment(cwd, &req.upstream_repo, n, &comment_body) {
            Ok(_) => set_stage(
                &mut stages,
                &app,
                3,
                "success",
                format!("评论已发布到 PR #{n}。"),
            ),
            Err(e) => set_stage(&mut stages, &app, 3, "failed", format!("评论失败: {e}")),
        }
    } else {
        set_stage(
            &mut stages,
            &app,
            3,
            "skipped",
            "未取得 PR 号,跳过评论。".into(),
        );
    }
    let ok_comment = stages[3].status != "failed";
    let msg = if ok_comment {
        format!("PR 工作流完成。{pr_url}")
    } else {
        format!("PR 已创建,但评论步失败:{pr_url}")
    };
    finish(&mut stages, true, msg, None, Some((pr_url, pr_number)))
}
