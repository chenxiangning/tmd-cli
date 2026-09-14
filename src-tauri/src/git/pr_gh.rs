//! gh CLI 执行与 GitHub 串解析 —— 创建 PR 工作流的 forge 侧原语。
//!
//! PR 查询/创建/评论走 gh CLI(登录态由 gh 自管,应用零 token 存储);
//! git 侧 fetch/push/diff 复用 remote_ops::exec_git。执行纪律与 exec_git
//! 同款:非交互语义 + 总时长上限 + 双管道排空(gh pr create 也可能网络挂)。

use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use super::remote_ops::drain_pipe;
use super::GitError;

/// gh 网络操作总时限(与 remote_ops::REMOTE_TIMEOUT 同口径)。
const GH_TIMEOUT: Duration = Duration::from_secs(300);
/// try_wait 轮询间隔。
const GH_POLL: Duration = Duration::from_millis(200);

/// 执行 gh 子命令:非交互 + 总时长上限 + 双管道排空。
/// stderr 并入返回值;非零退出按 git 同规则分类(凭据特征 → Auth)。
pub(super) fn run(cwd: &str, args: &[String]) -> Result<String, GitError> {
    let mut cmd = Command::new("gh");
    /* LC_ALL=C:gh 输出按英文解析,不随用户 locale 漂移。 */
    cmd.current_dir(cwd).env("LC_ALL", "C").env("LANG", "C");
    crate::resolve::hide_console(&mut cmd);
    cmd.args(args);

    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| GitError::shell(format!("gh 启动失败(请确认已安装 GitHub CLI): {e}")))?;
    let out_rx = drain_pipe(child.stdout.take());
    let err_rx = drain_pipe(child.stderr.take());

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Ok(None) => {
                if started.elapsed() >= GH_TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(GitError::empty(
                        "gh 操作超时(>300s),已中止;请检查网络后重试",
                    ));
                }
                std::thread::sleep(GH_POLL);
            }
            Err(e) => return Err(GitError::shell(format!("gh 等待失败: {e}"))),
        }
    };
    let stdout = out_rx
        .recv_timeout(super::remote_ops::PIPE_DRAIN_TIMEOUT)
        .unwrap_or_default();
    let stderr = err_rx
        .recv_timeout(super::remote_ops::PIPE_DRAIN_TIMEOUT)
        .unwrap_or_default();
    let mut combined = String::from_utf8_lossy(&stdout).into_owned();
    if !stderr.is_empty() {
        if !combined.ends_with('\n') && !combined.is_empty() {
            combined.push('\n');
        }
        combined.push_str(&String::from_utf8_lossy(&stderr));
    }
    if !status.success() {
        return Err(GitError::from_shell_output(&combined));
    }
    Ok(combined)
}

/// 预检:gh 已安装且已登录 github.com。缺失/未登录给终端指引。
pub(super) fn precheck(cwd: &str) -> Result<(), GitError> {
    run(cwd, &["--version".to_string()])?;
    run(
        cwd,
        &[
            "auth".to_string(),
            "status".to_string(),
            "-h".to_string(),
            "github.com".to_string(),
        ],
    )
    .map_err(|e| {
        GitError::shell(format!(
            "gh 未登录 GitHub,请先在终端执行 `gh auth login` 后重试。{e}"
        ))
    })?;
    Ok(())
}

/// 远端 URL → "owner/repo"(https / ssh / git@ 三形态;.git 后缀可选)。
pub fn parse_github_repo(url: &str) -> Option<String> {
    let s = url.trim().trim_end_matches('/');
    let idx = s.find("github.com")?;
    let rest = s[idx + "github.com".len()..].trim_start_matches(['/', ':']);
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let mut segs = rest.split('/').filter(|p| !p.is_empty());
    let owner = segs.next()?;
    let repo = segs.next()?;
    Some(format!("{owner}/{repo}"))
}

/// gh 输出 → PR URL(取含 /pull/ 的最后一个 token)。
pub fn parse_pr_url(out: &str) -> Option<String> {
    out.split_whitespace()
        .rev()
        .find(|t| t.contains("github.com") && t.contains("/pull/"))
        .map(str::to_string)
}

/// PR URL → PR 号。
pub fn parse_pr_number(url: &str) -> Option<u64> {
    url.split("/pull/")
        .nth(1)?
        .split(['/', '?', '#'])
        .next()?
        .parse()
        .ok()
}

/// `gh pr list --json number,url` 输出 → 首个 (url, number);空表 = None。
pub(super) fn parse_existing_pr(out: &str) -> Option<(String, u64)> {
    #[derive(serde::Deserialize)]
    struct ExistingPr {
        number: u64,
        url: String,
    }
    let prs: Vec<ExistingPr> = serde_json::from_str(out).ok()?;
    prs.into_iter().next().map(|p| (p.url, p.number))
}
/* ── 工作流步骤级封装(pr_workflow 调用;gh 参数拼装统一在此)── */

/// `pr <子命令…> --repo <upstream>`:flag 置尾,不吞子命令。
fn gh_args(upstream: &str, args: &[String]) -> Vec<String> {
    let mut v = vec!["pr".to_string()];
    v.extend(args.iter().cloned());
    v.push("--repo".into());
    v.push(upstream.to_string());
    v
}

/// 已有 PR 复用(state=all 查询),否则 `gh pr create`;create 失败先 state=open
/// 补查(create 偶发已建但报错),仍无则把 gh 原始错误透传给调用方展示。
/// 成功返回 (url, number);新建时 number=0,由调用方经 parse_pr_number 回填。
pub(super) fn ensure_pr(
    cwd: &str,
    upstream: &str,
    base: &str,
    head_full: &str,
    title: &str,
    body: Option<String>,
) -> Result<(String, u64), String> {
    let lookup = |state: &str| -> Option<(String, u64)> {
        run(
            cwd,
            &gh_args(
                upstream,
                &[
                    "list".into(),
                    "--state".into(),
                    state.into(),
                    "--head".into(),
                    head_full.into(),
                    "--json".into(),
                    "number,url".into(),
                    "--limit".into(),
                    "5".into(),
                ],
            ),
        )
        .ok()
        .and_then(|out| parse_existing_pr(&out))
    };
    if let Some(pr) = lookup("all") {
        return Ok(pr);
    }
    match run(
        cwd,
        &gh_args(
            upstream,
            &[
                "create".into(),
                "--base".into(),
                base.into(),
                "--head".into(),
                head_full.into(),
                "--title".into(),
                title.into(),
                "--body".into(),
                body.unwrap_or_default(),
            ],
        ),
    ) {
        Ok(text) => parse_pr_url(&text)
            .map(|u| (u, 0))
            .ok_or_else(|| format!("gh 已执行但未返回 PR 地址:{}", text.trim())),
        Err(e) => lookup("open").ok_or_else(|| e.to_string()),
    }
}

/// `gh pr comment <n> --body`;Err 原样上抛,由调用方降级(评论失败不拖垮整体)。
pub(super) fn comment(
    cwd: &str,
    upstream: &str,
    number: u64,
    body: &str,
) -> Result<String, GitError> {
    run(
        cwd,
        &gh_args(
            upstream,
            &[
                "comment".into(),
                number.to_string(),
                "--body".into(),
                body.into(),
            ],
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_repo_parsed_from_url_forms() {
        assert_eq!(
            parse_github_repo("https://github.com/zhukunpenglinyutong/desktop-cc-gui.git"),
            Some("zhukunpenglinyutong/desktop-cc-gui".into())
        );
        assert_eq!(
            parse_github_repo("git@github.com:chenxiangning/tmd-cli.git"),
            Some("chenxiangning/tmd-cli".into())
        );
        assert_eq!(
            parse_github_repo("ssh://git@github.com/o/r"),
            Some("o/r".into())
        );
        assert_eq!(parse_github_repo("https://gitlab.com/o/r"), None);
    }

    #[test]
    fn pr_url_and_number_extracted() {
        let out = "Creating pull request for feat:x\nhttps://github.com/o/r/pull/1215\n";
        let url = parse_pr_url(out).unwrap();
        assert_eq!(parse_pr_number(&url), Some(1215));
        assert_eq!(parse_pr_url("no url here"), None);
    }

    #[test]
    fn existing_pr_json_parsed() {
        assert_eq!(
            parse_existing_pr(r#"[{"number":12,"url":"https://github.com/o/r/pull/12"}]"#),
            Some(("https://github.com/o/r/pull/12".into(), 12))
        );
        assert_eq!(parse_existing_pr("[]"), None);
    }
}
