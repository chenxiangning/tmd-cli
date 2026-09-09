//! 磁盘会话日志指针与尾读 —— 「磁盘会话先行回放」的原生侧寻址。
//!
//! 痛点:日志按 spawn 代 uuid 命名,冷开的磁盘会话没有 Rust 会话 id,
//! `session_history_page` 寻址不上上一代日志。这里用每 CLI 会话一个指针
//! 文件(`<cliSessionId>.logptr`,内容 = 当前代日志 uuid)补上映射:
//! 前端在身份绑定时刻无条件覆写,冷开时解指针读上一代日志尾,前端分块
//! 回放填幕布,零进程出画面。
//! 信任边界:cli_session_id/log_id 来自前端,拒绝空串、路径分隔符与 `..`,
//! 杜绝拼接逃逸;离线读语义 base=0/written=file_len,返回页的
//! startOffset/hasMore 是文件相对假绝对偏移,消费方只准用 text。

use std::fs;
use std::path::{Path, PathBuf};

use crate::session_log::{read_history_page, HistoryPage};

/// 尾读服务端硬上限:前端 512KB 窗口已够墓碑帧,防任意量级读盘。
const DISK_TAIL_MAX: u64 = 1024 * 1024;

/// 指针/日志所在目录,与会话日志同目录(路径构成见 session_log::session_log_path)。
fn log_dir(profile_id: &str, cwd: &str) -> PathBuf {
    crate::session::config_dir()
        .join("session")
        .join(crate::session_log::project_slug(profile_id))
        .join(crate::session_log::project_slug(cwd))
}

/// 路径组件白名单校验:uuid 形态(空串/分隔符/`..` 一律拒绝)。
fn validate_component(value: &str) -> Result<(), String> {
    if value.is_empty() || value.contains("..") || value.contains(['/', '\\', ':']) {
        return Err(format!("非法路径组件: {value}"));
    }
    Ok(())
}

fn pointer_path(dir: &Path, cli_session_id: &str) -> PathBuf {
    dir.join(format!("{cli_session_id}.logptr"))
}

/// 身份绑定时刻回写指针(无条件覆写,最新代胜出)。
pub(crate) fn write_log_pointer(
    profile_id: &str,
    cwd: &str,
    cli_session_id: &str,
    log_id: &str,
) -> Result<(), String> {
    write_log_pointer_into(&log_dir(profile_id, cwd), cli_session_id, log_id)
}

pub(crate) fn write_log_pointer_into(
    dir: &Path,
    cli_session_id: &str,
    log_id: &str,
) -> Result<(), String> {
    validate_component(cli_session_id)?;
    validate_component(log_id)?;
    fs::create_dir_all(dir).map_err(|e| format!("创建会话日志目录失败: {e}"))?;
    fs::write(pointer_path(dir, cli_session_id), log_id)
        .map_err(|e| format!("写会话日志指针失败: {e}"))
}

/// 冷开磁盘会话:解指针读上一代日志尾。指针/日志缺失或空文件 → None(前端回落现状路径)。
pub(crate) fn read_disk_tail(
    profile_id: &str,
    cwd: &str,
    cli_session_id: &str,
    max_bytes: u64,
) -> Result<Option<HistoryPage>, String> {
    read_disk_tail_from(&log_dir(profile_id, cwd), cli_session_id, max_bytes)
}

pub(crate) fn read_disk_tail_from(
    dir: &Path,
    cli_session_id: &str,
    max_bytes: u64,
) -> Result<Option<HistoryPage>, String> {
    validate_component(cli_session_id)?;
    let log_id = match fs::read_to_string(pointer_path(dir, cli_session_id)) {
        Ok(id) => id.trim().to_string(),
        Err(_) => return Ok(None),
    };
    validate_component(&log_id)?;
    let path = dir.join(format!("{log_id}.log"));
    let len = match fs::metadata(&path) {
        Ok(meta) => meta.len(),
        Err(_) => return Ok(None),
    };
    if len == 0 {
        return Ok(None);
    }
    read_history_page(&path, 0, len, len, max_bytes.min(DISK_TAIL_MAX)).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tmd-disk-log-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn seed_log(dir: &Path, log_id: &str, bytes: &[u8]) {
        fs::write(dir.join(format!("{log_id}.log")), bytes).unwrap();
    }

    #[test]
    fn 指针缺失返回_none() {
        let dir = temp_dir("missing-ptr");
        assert!(read_disk_tail_from(&dir, "cli-1", 512).unwrap().is_none());
    }

    #[test]
    fn 日志文件缺失返回_none() {
        let dir = temp_dir("missing-log");
        fs::write(pointer_path(&dir, "cli-1"), "ghost-uuid").unwrap();
        assert!(read_disk_tail_from(&dir, "cli-1", 512).unwrap().is_none());
    }

    #[test]
    fn 空日志返回_none() {
        let dir = temp_dir("empty-log");
        fs::write(pointer_path(&dir, "cli-1"), "uuid-1").unwrap();
        seed_log(&dir, "uuid-1", b"");
        assert!(read_disk_tail_from(&dir, "cli-1", 512).unwrap().is_none());
    }

    #[test]
    fn 正常读尾_文本完整_转义与多字节不劈() {
        let dir = temp_dir("tail");
        fs::write(pointer_path(&dir, "cli-1"), "uuid-1").unwrap();
        let mut bytes = b"\x1b[31m".to_vec();
        bytes.extend_from_slice("红色标题".as_bytes());
        bytes.extend_from_slice(b"\x1b[0m ");
        bytes.extend_from_slice("尾行".as_bytes());
        bytes.extend_from_slice(b"\n");
        seed_log(&dir, "uuid-1", &bytes);
        let page = read_disk_tail_from(&dir, "cli-1", 512).unwrap().unwrap();
        assert!(page.text.contains("红色标题"));
        assert!(page.text.contains("尾行"));
        assert!(!page.has_more);
    }

    #[test]
    fn max_bytes_clamp到服务端硬上限() {
        let dir = temp_dir("clamp");
        fs::write(pointer_path(&dir, "cli-1"), "uuid-1").unwrap();
        let payload = vec![b'x'; 100];
        seed_log(&dir, "uuid-1", &payload);
        let page = read_disk_tail_from(&dir, "cli-1", DISK_TAIL_MAX * 4)
            .unwrap()
            .unwrap();
        assert!(page.text.len() <= DISK_TAIL_MAX as usize);
        assert_eq!(page.text.len(), 100);
    }

    #[test]
    fn 路径组件拒绝分隔符与dotdot() {
        let dir = temp_dir("reject");
        for bad in ["../evil", "a/b", "a\\b", "", ".."] {
            assert!(write_log_pointer_into(&dir, bad, "uuid").is_err());
            assert!(write_log_pointer_into(&dir, "cli-1", bad).is_err());
            assert!(read_disk_tail_from(&dir, bad, 512).is_err());
        }
        assert!(read_disk_tail_from(&dir, "cli-1", 512).unwrap().is_none());
    }

    #[test]
    fn 指针覆写_最新代胜出() {
        let dir = temp_dir("overwrite");
        fs::write(pointer_path(&dir, "cli-1"), "old-uuid").unwrap();
        seed_log(&dir, "old-uuid", b"old frame");
        seed_log(&dir, "new-uuid", b"new frame");
        write_log_pointer_into(&dir, "cli-1", "new-uuid").unwrap();
        let page = read_disk_tail_from(&dir, "cli-1", 512).unwrap().unwrap();
        assert!(page.text.contains("new frame"));
    }
}
