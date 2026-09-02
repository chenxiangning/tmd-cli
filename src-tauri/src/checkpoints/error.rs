//! 错误类型 —— 与 git::GitError 同惯例:E_* 结构化前缀经 Tauri Err(String) 传前端。

use std::fmt;

#[derive(Debug)]
pub enum CkptError {
    /// cwd 不在 git 仓库内(MVP 仅支持 git 工作区,前端灰化面板)
    NotARepo(String),
    /// 输入/状态校验失败(批次不存在/已处理/无可回退路径)
    Empty(String),
    /// sidecar 存储损坏
    Store(String),
    /// libgit2 错误(用户仓库或 sidecar)
    Libgit2(git2::Error),
    /// 文件系统 IO
    Io(std::io::Error),
}

impl fmt::Display for CkptError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotARepo(p) => write!(f, "E_NOT_A_REPO: {p}"),
            Self::Empty(m) => write!(f, "E_EMPTY: {m}"),
            Self::Store(m) => write!(f, "E_STORE: {m}"),
            Self::Libgit2(e) => write!(f, "E_GIT2: {}", e.message()),
            Self::Io(e) => write!(f, "E_IO: {e}"),
        }
    }
}

impl From<git2::Error> for CkptError {
    fn from(e: git2::Error) -> Self {
        Self::Libgit2(e)
    }
}

impl From<std::io::Error> for CkptError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

impl From<crate::git::GitError> for CkptError {
    fn from(e: crate::git::GitError) -> Self {
        match e {
            crate::git::GitError::NotARepo(p) => Self::NotARepo(p),
            crate::git::GitError::Libgit2(inner) => Self::Libgit2(inner),
            other => Self::Store(other.to_string()),
        }
    }
}

impl From<CkptError> for String {
    fn from(e: CkptError) -> Self {
        e.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_stable() {
        assert!(String::from(CkptError::NotARepo("/x".into())).starts_with("E_NOT_A_REPO:"));
        assert!(String::from(CkptError::Empty("m".into())).starts_with("E_EMPTY:"));
        assert!(String::from(CkptError::Store("s".into())).starts_with("E_STORE:"));
    }
}
