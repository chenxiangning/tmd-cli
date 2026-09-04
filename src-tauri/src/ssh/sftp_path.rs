//! SFTP 路径原语与纯谓词 —— 远端路径归一/拼接/父子推导、写冲突与错误分类,
//! 独立成件供 sftp.rs 与传输侧共用。

use super::sftp::SftpEntry;

/// 错误属于「连接已死」→ 弃缓存,调用方重试一次。
pub(crate) fn is_session_closed_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains("session closed")
        || normalized.contains("channel closed")
        || normalized.contains("connection closed")
        || normalized.contains("broken pipe")
        || normalized.contains("connection reset")
        || normalized.contains("eof")
}

pub(crate) fn is_not_found_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains("no such") || normalized.contains("not found")
}

/// SFTP mtime 秒粒度,同秒同尺寸重写会漏检 —— mtime+size 双比对收窄窗口。
pub(crate) fn is_write_conflict(
    expected_mtime: Option<u64>,
    expected_size: Option<u64>,
    current: &SftpEntry,
) -> bool {
    if expected_mtime.is_some_and(|expected| expected != current.mtime) {
        return true;
    }
    expected_size.is_some_and(|expected| expected != current.size_bytes)
}

pub(crate) fn normalize_remote_path(path: &str) -> String {
    let raw = path.trim().replace('\\', "/");
    if raw.is_empty() || raw == "." {
        return ".".to_string();
    }
    let absolute = raw.starts_with('/');
    let mut parts = Vec::new();
    for part in raw.split('/') {
        let part = part.trim();
        if part.is_empty() || part == "." || part == ".." {
            continue;
        }
        parts.push(part);
    }
    if absolute {
        if parts.is_empty() {
            "/".to_string()
        } else {
            format!("/{}", parts.join("/"))
        }
    } else if parts.is_empty() {
        ".".to_string()
    } else {
        parts.join("/")
    }
}

pub(crate) fn join_remote_path(parent: &str, child: &str) -> String {
    let child = child.trim().trim_matches('/');
    if child.is_empty() {
        return normalize_remote_path(parent);
    }
    let parent = normalize_remote_path(parent);
    if parent == "/" {
        format!("/{child}")
    } else if parent == "." {
        child.to_string()
    } else {
        format!("{}/{}", parent.trim_end_matches('/'), child)
    }
}

pub(crate) fn remote_parent_path(path: &str) -> Option<String> {
    let path = normalize_remote_path(path);
    if path == "." || path == "/" {
        return None;
    }
    match path.rsplit_once('/') {
        Some(("", _)) => Some("/".to_string()),
        Some((parent, _)) if !parent.is_empty() => Some(parent.to_string()),
        _ => Some(".".to_string()),
    }
}

pub(crate) fn remote_basename(path: &str) -> Option<String> {
    let path = normalize_remote_path(path);
    if path == "." || path == "/" {
        return None;
    }
    path.rsplit('/').next().map(|value| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_path_normalization() {
        assert_eq!(normalize_remote_path(" /a//b/./c\\d "), "/a/b/c/d");
        assert_eq!(normalize_remote_path("../etc/passwd"), "etc/passwd");
        assert_eq!(normalize_remote_path(""), ".");
        assert_eq!(normalize_remote_path("/"), "/");
        assert_eq!(normalize_remote_path("a/../../b"), "a/b");
    }

    #[test]
    fn remote_path_join_and_parent() {
        assert_eq!(join_remote_path("/", "tmp"), "/tmp");
        assert_eq!(join_remote_path("/var/log", "syslog"), "/var/log/syslog");
        assert_eq!(join_remote_path(".", "x"), "x");
        assert_eq!(remote_parent_path("/var/log"), Some("/var".into()));
        assert_eq!(remote_parent_path("/top"), Some("/".into()));
        assert_eq!(remote_parent_path("rel"), Some(".".into()));
    }

    #[test]
    fn write_conflict_detection() {
        let entry = SftpEntry {
            path: "/f".into(),
            name: "f".into(),
            kind: "file".into(),
            size_bytes: 10,
            mtime: 1000,
        };
        assert!(is_write_conflict(Some(999), None, &entry));
        assert!(is_write_conflict(None, Some(11), &entry));
        assert!(!is_write_conflict(Some(1000), Some(10), &entry));
    }

    #[test]
    fn closed_and_not_found_error_matching() {
        assert!(is_session_closed_error("Sftp session closed"));
        assert!(is_not_found_error("No such file"));
        assert!(!is_session_closed_error("permission denied"));
    }
}
