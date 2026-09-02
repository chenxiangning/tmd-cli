//! 错误类型 —— E_* 结构化前缀经 Tauri Err(String) 传到前端。
//! 前端用 startsWith 匹配,中文文案可自由迭代而契约不破。

use std::fmt;

#[derive(Debug)]
pub enum GitError {
    /// 不在 git 仓库内(前端空态,不弹 toast)
    NotARepo(String),
    /// 输入校验失败(空 message / 无变更 / 参数非法)
    Empty(String),
    /// libgit2 原生错误
    Libgit2(git2::Error),
    /// shell-out(fetch/pull/push)非凭据类失败
    Shell(String),
    /// 远端凭据失败(BatchMode 拒绝 / Permission denied),引导用户去终端
    Auth(String),
}

impl GitError {
    pub fn empty(msg: impl Into<String>) -> Self {
        Self::Empty(msg.into())
    }

    pub fn shell(msg: impl Into<String>) -> Self {
        Self::Shell(msg.into())
    }

    /// 按 stderr 特征分类:凭据类 → Auth,其余 → Shell。
    pub fn from_shell_output(output: &str) -> Self {
        let lower = output.to_lowercase();
        let is_auth = lower.contains("permission denied")
            || lower.contains("authentication failed")
            || lower.contains("could not read username")
            || lower.contains("host key verification failed");
        if is_auth {
            Self::Auth(output.trim().to_string())
        } else {
            Self::Shell(output.trim().to_string())
        }
    }
}

impl fmt::Display for GitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotARepo(p) => write!(f, "E_NOT_A_REPO: {p}"),
            Self::Empty(m) => write!(f, "E_EMPTY: {m}"),
            Self::Libgit2(e) => write!(f, "E_GIT2: {}", e.message()),
            Self::Shell(s) => write!(f, "E_SHELL: {s}"),
            Self::Auth(s) => write!(f, "E_AUTH: {s}"),
        }
    }
}

impl From<git2::Error> for GitError {
    fn from(e: git2::Error) -> Self {
        Self::Libgit2(e)
    }
}

impl From<std::io::Error> for GitError {
    fn from(e: std::io::Error) -> Self {
        Self::Shell(e.to_string())
    }
}

/// Tauri command 返回 Err(String)。
impl From<GitError> for String {
    fn from(e: GitError) -> Self {
        e.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_stable() {
        assert!(String::from(GitError::NotARepo("/x".into())).starts_with("E_NOT_A_REPO:"));
        assert!(String::from(GitError::empty("m")).starts_with("E_EMPTY:"));
        assert!(String::from(GitError::shell("s")).starts_with("E_SHELL:"));
        assert!(String::from(GitError::Auth("a".into())).starts_with("E_AUTH:"));
    }

    #[test]
    fn shell_output_classified() {
        assert!(matches!(
            GitError::from_shell_output("git@github.com: Permission denied (publickey)."),
            GitError::Auth(_)
        ));
        assert!(matches!(
            GitError::from_shell_output("fatal: refusing to merge unrelated histories"),
            GitError::Shell(_)
        ));
    }
}
