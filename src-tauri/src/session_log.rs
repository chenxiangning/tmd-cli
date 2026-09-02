//! 会话输出日志 —— PTY 原始字节落盘 + 幕布往前翻页。
//!
//! 每会话一个日志文件(`~/.tmd-cli/session/<引擎>/<项目-slug>/<id>.log`),
//! 泵线程按批次追加原始字节;64MB 上限旋转截头,偏移账本(base/written)
//! 保证前端翻页锚点(绝对字节偏移)永不因截头失效。
//! 翻页读取做转义序列/UTF-8 双边界对齐(与前端 streamSlice 同构),
//! 残片不会被 xterm 当文本画出。

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::Mutex;
use serde::Serialize;

/// 单会话日志文件上限(64MB):超出后截断最旧部分,保留尾部 KEEP。
const SESSION_LOG_CAP: u64 = 64 * 1024 * 1024;
/// 旋转后保留的尾部长度(32MB):滞后设计,避免每超一点就重写文件。
const SESSION_LOG_KEEP: u64 = 32 * 1024 * 1024;
/// 翻页边界对齐的回看窗口:常规转义序列远短于此,超长 OSC 由绝对偏移对齐兜底。
const LOG_ALIGN_LOOKBACK: u64 = 4096;
/// 会话日志的偏移账本:written = 累计写入的绝对字节数;base = 文件头对应的绝对偏移(旋转截断后 >0)。
/// 绝对偏移设计:旋转只推进 base,前端持有的翻页锚点永不因文件截头而失效。
#[derive(Clone)]
pub(crate) struct LogMeta {
    pub written: u64,
    pub base: u64,
    pub path: PathBuf,
}

/// 翻页结果。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub text: String,
    /// 本页起点在全量输出中的绝对字节偏移(含已被截断的部分)。
    pub start_offset: u64,
    /// 是否还有更早数据可翻(日志头部被 64MB 上限截断后为 false)。
    pub has_more: bool,
}

/// Claude Code 同款项目目录命名:路径分隔符与盘符冒号 → '-'。
/// `/Users/x/code/tmd-cli` → `-Users-x-code-tmd-cli`
fn project_slug(cwd: &str) -> String {
    cwd.replace(['/', '\\', ':'], "-")
}

/// 会话日志路径:`~/.tmd-cli/session/<引擎>/<项目-slug>/<id>.log`。
pub(crate) fn session_log_path(profile_id: &str, cwd: &str, id: &str) -> PathBuf {
    crate::session::config_dir()
        .join("session")
        .join(project_slug(profile_id))
        .join(project_slug(cwd))
        .join(format!("{id}.log"))
}

/// 与前端 streamSlice 同构:返回 buf 中从 esc 开始的转义序列的结束下标(不含);
/// 序列延伸到 buf 末尾(不完整)返回 None。
fn sequence_end(buf: &[u8], esc: usize) -> Option<usize> {
    let kind = *buf.get(esc + 1)?;
    if kind == b'[' {
        /* CSI:参数/中间字节之后以 0x40–0x7E 的 final byte 收尾 */
        let mut i = esc + 2;
        while i < buf.len() {
            if (0x40..=0x7e).contains(&buf[i]) {
                return Some(i + 1);
            }
            i += 1;
        }
        None
    } else if kind == b']' {
        /* OSC(超链接/窗口标题等,可长达数百字符):以 BEL 或 ESC\ 收尾 */
        let mut i = esc + 2;
        while i < buf.len() {
            if buf[i] == 0x07 {
                return Some(i + 1);
            }
            if buf[i] == 0x1b && buf.get(i + 1) == Some(&b'\\') {
                return Some(i + 2);
            }
            i += 1;
        }
        None
    } else {
        /* 其余转义(字符集选择等)至多 3 字节;宁可保守视为更长 */
        Some((esc + 3).min(buf.len()))
    }
}

/// 日志旋转:把尾部 KEEP 字节搬到同目录临时文件,原子改名覆盖,重开 append 句柄。
fn rotate_log(file: &mut File, path: &Path) -> std::io::Result<()> {
    let file_len = file.metadata()?.len();
    let keep = SESSION_LOG_KEEP.min(file_len);
    let tmp = path.with_extension("tmp");
    {
        let mut src = File::open(path)?;
        src.seek(SeekFrom::End(-(keep as i64)))?;
        let mut dst = File::create(&tmp)?;
        std::io::copy(&mut src, &mut dst)?;
    }
    std::fs::rename(&tmp, path)?;
    *file = OpenOptions::new().append(true).open(path)?;
    Ok(())
}

/// 追加原始字节到会话日志;超 CAP 先旋转(截断最旧)。任一步失败由调用方降级(关闭日志)。
pub(crate) fn append_log(
    logs: &Arc<Mutex<HashMap<String, LogMeta>>>,
    id: &str,
    file: &mut File,
    path: &Path,
    bytes: &[u8],
) -> std::io::Result<()> {
    let need_rotate = match logs.lock().get(id) {
        Some(m) => m.written - m.base + bytes.len() as u64 > SESSION_LOG_CAP,
        None => return Ok(()), // 账本已移除(会话清理中) → 停写
    };
    if need_rotate {
        rotate_log(file, path)?;
        let mut locked = logs.lock();
        if let Some(meta) = locked.get_mut(id) {
            let file_len = meta.written - meta.base;
            meta.base = meta.written - SESSION_LOG_KEEP.min(file_len);
        }
    }
    file.write_all(bytes)?;
    if let Some(meta) = logs.lock().get_mut(id) {
        meta.written += bytes.len() as u64;
    }
    Ok(())
}

/// 读取 before 绝对偏移之前最多 max_bytes 字节的原始输出,起点做转义序列/UTF-8 双边界对齐。
pub(crate) fn read_history_page(
    path: &Path,
    base: u64,
    written: u64,
    before: u64,
    max_bytes: u64,
) -> Result<HistoryPage, String> {
    let end = before.min(written);
    if end <= base {
        return Ok(HistoryPage {
            text: String::new(),
            start_offset: base,
            has_more: false,
        });
    }
    let file_end = end - base;
    let file_start = file_end.saturating_sub(max_bytes);
    let lookback = file_start.min(LOG_ALIGN_LOOKBACK);
    let read_start = file_start - lookback;

    let mut file = File::open(path).map_err(|e| format!("打开会话日志失败: {e}"))?;
    file.seek(SeekFrom::Start(read_start))
        .map_err(|e| format!("定位会话日志失败: {e}"))?;
    let mut buf = vec![0u8; (file_end - read_start) as usize];
    /* 与日志旋转并发时文件可能被换短:读不满按实际长度降级 */
    let mut filled = 0usize;
    while filled < buf.len() {
        match file.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(e) => return Err(format!("读取会话日志失败: {e}")),
        }
    }
    buf.truncate(filled);
    let rel = (file_start - read_start) as usize;
    if rel > buf.len() {
        return Err("会话日志被并发截断,请重试".to_string());
    }
    let mut start_idx = rel;
    /* 转义序列对齐:截断点落在未完结序列内 → 起点退到该序列的 ESC */
    if let Some(esc) = buf[..=rel].iter().rposition(|&b| b == 0x1b) {
        let crosses = match sequence_end(&buf, esc) {
            Some(seq_end) => seq_end > rel,
            None => true,
        };
        if crosses {
            start_idx = esc;
        }
    }
    /* UTF-8 对齐:起点若劈在多字节字符中间 → 回退到字符 lead byte(ESC 起点天然对齐) */
    if buf[start_idx] != 0x1b {
        while start_idx > 0 && (buf[start_idx] & 0xC0) == 0x80 {
            start_idx -= 1;
        }
    }
    let text = String::from_utf8_lossy(&buf[start_idx..]).into_owned();
    let start_offset = base + read_start + start_idx as u64;
    Ok(HistoryPage {
        text,
        start_offset,
        has_more: start_offset > base,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_log(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("tmd-test-{name}-{}.log", std::process::id()));
        std::fs::write(&path, bytes).unwrap();
        path
    }
    #[test]
    fn history_page_纯文本整页返回() {
        let path = temp_log("plain", b"hello world");
        let page = read_history_page(&path, 0, 11, 11, 4096).unwrap();
        assert_eq!(page.text, "hello world");
        assert_eq!(page.start_offset, 0);
        assert!(!page.has_more);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn history_page_截断点落在_csi_中间时退回序列起点() {
        let content = b"AAA\x1b[38;2;107;114;128mBBB\x1b[0mCCC";
        let path = temp_log("csi", content);
        /* max_bytes=3 → 窗口起点落在 "[38;2;..." 序列内 → 必须退到下标 3 的 ESC */
        let page = read_history_page(&path, 0, content.len() as u64, 8, 3).unwrap();
        assert_eq!(page.start_offset, 3);
        assert_eq!(page.text, "\x1b[38;");
        assert!(page.has_more);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn history_page_截断点落在长_osc_中间时退回序列起点() {
        let url = format!("http://example.com/{}", "a".repeat(200));
        let content = format!("pre\x1b]8;;{url}\x1b\\link");
        let bytes = content.as_bytes();
        let path = temp_log("osc", bytes);
        /* max_bytes=8 → 窗口起点落在 URL 中段 → 必须退到下标 3 的 OSC 起点 */
        let page = read_history_page(&path, 0, bytes.len() as u64, 20, 8).unwrap();
        assert_eq!(page.start_offset, 3);
        assert!(page.text.starts_with("\x1b]8;;"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn history_page_截断点劈开多字节字符时回退到_lead_byte() {
        let bytes = "中文abc".as_bytes(); // 中=0..3 文=3..6
        let path = temp_log("utf8", bytes);
        /* max_bytes=8 → 窗口起点落在 "中" 第 2 字节,必须回退到 0 */
        let page = read_history_page(&path, 0, bytes.len() as u64, bytes.len() as u64, 8).unwrap();
        assert_eq!(page.start_offset, 0);
        assert_eq!(page.text, "中文abc");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn history_page_before_不早于_base_时返回空() {
        let path = temp_log("base", &[b'x'; 256]);
        let page = read_history_page(&path, 100, 200, 50, 4096).unwrap();
        assert_eq!(page.text, "");
        assert_eq!(page.start_offset, 100);
        assert!(!page.has_more);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn project_slug_路径转连字符() {
        assert_eq!(project_slug("/Users/x/code/tmd-cli"), "-Users-x-code-tmd-cli");
        assert_eq!(project_slug("C:\\code\\proj"), "C--code-proj");
    }
}
