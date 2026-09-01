//! git 服务：纯 git CLI shell-out（第六轮决策：不引 git2，复刻 mossx 写路径模式）。
//!
//! 骨架阶段只实现 status；diff/commit/branch 随 git 插件实装时补。

use std::process::Command;

fn run_git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("git 启动失败: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// 当前分支 + porcelain 状态。原始文本返回，解析在前端 git 插件做。
pub fn status(cwd: &str) -> Result<GitStatus, String> {
    let branch = run_git(cwd, &["rev-parse", "--abbrev-ref", "HEAD"])?
        .trim()
        .to_string();
    let porcelain = run_git(cwd, &["status", "--porcelain=v1", "--branch"])?;
    Ok(GitStatus { branch, porcelain })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: String,
    pub porcelain: String,
}
