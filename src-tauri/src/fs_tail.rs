//! 文件尾读原语(read_tail / read_tail_changed):会话状态巡航与 JSONL 尾窗解析的数据面。
//! 自 fs.rs 拆出(文件规模铁则),经 fs.rs re-export 保持 crate::fs::read_tail 引用路径不变。

use serde::Serialize;
use std::fs;

/// 读取文件尾部最多 max_bytes 字节(UTF-8 损失容忍)。
/// 给 JSONL session 状态解析用,避免把完整对话文件加载到前端。
pub fn read_tail(path: &str, max_bytes: usize) -> Result<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = fs::File::open(path).map_err(|e| format!("打开文件失败: {e}"))?;
    let file_len = f
        .metadata()
        .map_err(|e| format!("读取文件信息失败: {e}"))?
        .len();
    let offset = file_len.saturating_sub(max_bytes as u64);
    f.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("定位文件失败: {e}"))?;
    let mut buf = Vec::with_capacity((file_len - offset) as usize);
    f.read_to_end(&mut buf)
        .map_err(|e| format!("读取文件失败: {e}"))?;
    Ok(String::from_utf8_lossy(&buf).to_string())
}

/// 条件尾读结果:changed = 尺寸相对 last_size 有变(或首次探测);size = 当前字节数。
#[derive(Debug, Serialize)]
pub struct ChangedTail {
    pub changed: bool,
    pub size: u64,
    pub text: String,
}

/// 尾读 + 尺寸闸(会话状态巡航 2s 一拍):append-only 日志尺寸未变即短路免读,
/// 变化拍一次 IPC 同时完成探测与读取。last_size = None 强制读。
pub fn read_tail_changed(
    path: &str,
    max_bytes: usize,
    last_size: Option<u64>,
) -> Result<ChangedTail, String> {
    let f = fs::File::open(path).map_err(|e| format!("打开文件失败: {e}"))?;
    let size = f
        .metadata()
        .map_err(|e| format!("读取文件信息失败: {e}"))?
        .len();
    if last_size == Some(size) {
        return Ok(ChangedTail {
            changed: false,
            size,
            text: String::new(),
        });
    }
    let text = read_tail_from(f, size, max_bytes)?;
    Ok(ChangedTail {
        changed: true,
        size,
        text,
    })
}

/// 已持句柄的尾读(read_tail 同语义,供 read_tail_changed 复用免二次 open)。
fn read_tail_from(mut f: fs::File, file_len: u64, max_bytes: usize) -> Result<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    let offset = file_len.saturating_sub(max_bytes as u64);
    f.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("定位文件失败: {e}"))?;
    let mut buf = Vec::with_capacity((file_len - offset) as usize);
    f.read_to_end(&mut buf)
        .map_err(|e| format!("读取文件失败: {e}"))?;
    Ok(String::from_utf8_lossy(&buf).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("tmd-cli-tail-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("创建临时目录失败");
        root
    }

    #[test]
    fn read_tail_changed_四态() {
        let root = temp_root("changed");
        let p = root.join("log.jsonl");
        let path = p.to_str().unwrap();
        std::fs::write(&p, "line1\nline2\n").unwrap();

        // 首读(last_size = None):强制读全文
        let first = read_tail_changed(path, 1024, None).unwrap();
        assert!(first.changed);
        assert_eq!(first.size, 12);
        assert_eq!(first.text, "line1\nline2\n");

        // 同尺寸短路:零读
        let probe = read_tail_changed(path, 1024, Some(first.size)).unwrap();
        assert!(!probe.changed);
        assert!(probe.text.is_empty());
        assert_eq!(probe.size, 12);

        // 增长:判变 + 尾窗全文
        std::fs::write(&p, "line1\nline2\nline3-longer\n").unwrap();
        let grown = read_tail_changed(path, 1024, Some(12)).unwrap();
        assert!(grown.changed);
        assert_eq!(grown.text, "line1\nline2\nline3-longer\n");

        // 收缩(截断/替换):尺寸不等即判变
        std::fs::write(&p, "x\n").unwrap();
        let shrunk = read_tail_changed(path, 1024, Some(999)).unwrap();
        assert!(shrunk.changed);
        assert_eq!(shrunk.text, "x\n");
        let _ = fs::remove_dir_all(&root);
    }
}
