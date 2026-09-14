//! 创建 PR 工作流 —— Precheck→Push→Create PR→Comment 四步编排。
//!
//! mossx commands_pr_workflow 复刻(设计 spec 2026-09-15):预检(gh 可用 +
//! upstream 范围闸门)→ 推送(fork origin)→ 建 PR(已有复用)→ 可选审批评论。
//! 阶段状态经 `git://pr-stage` 实时推给前端四卡;软失败(闸门确认/评论失败)
//! 走 ok=false 结果体,Err 只留给仓库级硬错。类型对齐 kernel/gitContract.ts。

use git2::Repository;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::pr_defaults::PR_BODY_TEMPLATE;
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
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrStage {
    pub key: String,
    pub status: String,
    pub detail: String,
}

/* PrConfirmation 已随范围闸门移除(2026-09-15)。 */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrWorkflowResult {
    pub ok: bool,
    pub message: String,
    pub pr_url: Option<String>,
    pub pr_number: Option<u64>,
    pub stages: Vec<PrStage>,
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

/// 四步工作流主体(with_repo_mut 锁内;软失败返回 ok=false 结果体)。
pub fn run(
    repo: &mut Repository,
    cwd: &str,
    req: PrRequest,
    app: AppHandle,
) -> Result<PrWorkflowResult, GitError> {
    let mut stages = stages_new();
    let finish =
        |stages: &mut Vec<PrStage>, ok: bool, message: String, pr: Option<(String, u64)>| {
            let _ = app.emit(STAGE_EVENT, stages.clone());
            Ok(PrWorkflowResult {
                ok,
                message,
                pr_url: pr.as_ref().map(|(u, _)| u.clone()),
                pr_number: pr.as_ref().map(|(_, n)| *n),
                stages: stages.clone(),
            })
        };
    fn step_err(e: GitError) -> GitError {
        GitError::shell(format!("预检失败: {e}"))
    }
    /* Precheck 仅查 gh 可用性(2026-09-15 复审后按用户决定移除范围闸门,
     * PR 内容不再做本地限制;错误基线/超大范围交 gh 与 GitHub 服务端裁决)。 */
    pr_gh::precheck(cwd).map_err(step_err)?;
    set_stage(&mut stages, &app, 0, "success", "gh 就绪。".into());

    /* ── Push:推 HEAD 到 fork origin 的 head 分支 ── */
    /* 前置闸:工作流推的是 HEAD 且 -u 会重接当前分支 upstream;compare 下拉允许
     * 选任意本地分支,与当前分支不一致时推上去的是 HEAD 的提交 + 跟踪被改写到
     * origin/<head_branch> = PR 内容错位(2026-09-15 评审)。软失败引导先检出,
     * 不做隐式跨分支推送。 */
    let head_now = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(str::to_string));
    if head_now.as_deref() != Some(req.head_branch.as_str()) {
        let msg = format!(
            "创建 PR 需先检出 {}:当前在 {}",
            req.head_branch,
            head_now.as_deref().unwrap_or("分离头指针")
        );
        set_stage(&mut stages, &app, 1, "failed", msg.clone());
        return finish(&mut stages, false, msg, None);
    }
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
            return finish(&mut stages, false, msg, None);
        }
    }

    /* ── Create PR:已有复用,否则 gh pr create(同仓 PR head 用纯分支名)── */
    set_stage(&mut stages, &app, 2, "running", "创建 PR…".into());
    let head_full =
        pr_gh::effective_head_ref(&req.upstream_repo, &req.head_owner, &req.head_branch);
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
    let (pr_url, mut pr_number) = match pr_gh::ensure_pr(
        cwd,
        &req.upstream_repo,
        &req.base_branch,
        &head_full,
        &req.title,
        body,
    ) {
        Ok(pr) => pr,
        Err(gh_err) => {
            let msg = format!("创建 PR 失败: {gh_err}");
            set_stage(&mut stages, &app, 2, "failed", msg.clone());
            return finish(&mut stages, false, msg, None);
        }
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
    finish(&mut stages, true, msg, Some((pr_url, pr_number)))
}
