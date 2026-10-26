//! 会话日志全文搜索 —— 自 session_log.rs 拆出(300 行铁则,同 fs_preview 先例)。
//! 字面量子串扫描 + 行去重定位条目 + 去转义行预览;大小写不敏感走 ASCII 折叠
//! (终端输出事实口径,Unicode 折叠留给前端缓冲内搜索)。活缓冲不在日志里的
//! 部分归前端 xterm 搜索,本模块只扫磁盘(≤64MB,手动触发)。

use std::fs::File;
use std::io::Read;
use std::path::Path;

use serde::Serialize;

use crate::session_log::sequence_end;

/// 日志全文搜索命中(行去重后的定位条目;byte_offset = 行起点,绝对坐标系与翻页锚点同源)。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogSearchHit {
    pub byte_offset: u64,
    /// 行预览:去转义序列/回车,截 240 字符。
    pub line: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogSearchResult {
    pub hits: Vec<LogSearchHit>,
    /// 原始命中计数(同行多处各计一次)。
    pub total_hits: u64,
    pub truncated: bool,
}

/// 命中列表行数上限(列表可滚,超限截断并标记;total_hits 仍为全量计数)。
const MAX_SEARCH_HIT_ROWS: usize = 200;
/// 行预览字符上限。
const SEARCH_HIT_LINE_CHARS: usize = 240;

pub(crate) fn search_log(
    path: &Path,
    base: u64,
    needle: &str,
    case_sensitive: bool,
) -> Result<LogSearchResult, String> {
    let needle = needle.trim();
    if needle.is_empty() {
        return Ok(LogSearchResult {
            hits: vec![],
            total_hits: 0,
            truncated: false,
        });
    }
    let mut file = File::open(path).map_err(|e| format!("打开会话日志失败: {e}"))?;
    let mut raw = Vec::new();
    file.read_to_end(&mut raw)
        .map_err(|e| format!("读取会话日志失败: {e}"))?;
    let pat: Vec<u8> = needle
        .bytes()
        .map(|b| {
            if case_sensitive {
                b
            } else {
                b.to_ascii_lowercase()
            }
        })
        .collect();

    /* 大小写不敏感路径:整仓预折叠一次(单遍 SIMD 友好),窗口比较走切片等
     * (memcmp 级)—— 原逐位置 map 是 O(n×m) 逐字节折叠,64MB 日志级慢
     * (2026-10-26 终轮复审);64MB 额外瞬态内存换扫描速度,手动触发可接受。
     * 大小写敏感路径零拷贝直借 raw。 */
    let folded: Vec<u8>;
    let hay: &[u8] = if case_sensitive {
        &raw
    } else {
        folded = raw.iter().map(|b| b.to_ascii_lowercase()).collect();
        &folded
    };

    let mut total: u64 = 0;
    let mut hits: Vec<LogSearchHit> = Vec::new();
    let mut last_line_start: Option<usize> = None;
    let mut i = 0usize;
    while i + pat.len() <= hay.len() {
        if hay[i..i + pat.len()] == pat[..] {
            total += 1;
            /* 行去重:同一行的多处命中只出一条定位条目(跳转目标 = 行起点)。 */
            let line_start = hay[..i]
                .iter()
                .rposition(|&b| b == b'\n')
                .map(|p| p + 1)
                .unwrap_or(0);
            if last_line_start != Some(line_start) && hits.len() < MAX_SEARCH_HIT_ROWS {
                last_line_start = Some(line_start);
                hits.push(LogSearchHit {
                    byte_offset: base + line_start as u64,
                    line: preview_line(&raw, line_start),
                });
            }
            i += pat.len();
        } else {
            i += 1;
        }
    }
    let truncated = hits.len() >= MAX_SEARCH_HIT_ROWS && total as usize > MAX_SEARCH_HIT_ROWS;
    Ok(LogSearchResult {
        hits,
        total_hits: total,
        truncated,
    })
}

/// 行预览:line_start 起到行尾(\n 或缓冲尾),剥转义序列与 \r,lossy 解码截宽。
fn preview_line(raw: &[u8], line_start: usize) -> String {
    let line_end = raw[line_start..]
        .iter()
        .position(|&b| b == b'\n')
        .map(|p| line_start + p)
        .unwrap_or(raw.len());
    let mut out: Vec<u8> = Vec::with_capacity(line_end - line_start);
    let mut i = line_start;
    while i < line_end {
        let b = raw[i];
        if b == 0x1b {
            match sequence_end(raw, i) {
                Some(end) => i = end,
                None => i = line_end,
            }
        } else {
            if b != b'\r' {
                out.push(b);
            }
            i += 1;
        }
    }
    let text = String::from_utf8_lossy(&out).into_owned();
    text.chars()
        .take(SEARCH_HIT_LINE_CHARS)
        .collect::<String>()
        .trim()
        .to_string()
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
    fn search_log_字面量命中与行去重() {
        let path = temp_log("search", b"ERR boom\nok\nERR again ERR twice\n");
        let r = search_log(&path, 0, "err", false).unwrap();
        assert_eq!(r.total_hits, 3);
        /* 命中行 2 条:首行 1 + 第三行(两处命中去重为一) */
        assert_eq!(r.hits.len(), 2);
        assert_eq!(r.hits[0].byte_offset, 0);
        assert_eq!(r.hits[0].line, "ERR boom");
        assert_eq!(r.hits[1].line, "ERR again ERR twice");
        assert!(!r.truncated);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn search_log_大小写敏感与空查询() {
        let path = temp_log("search-case", b"Err err");
        assert_eq!(search_log(&path, 0, "Err", true).unwrap().total_hits, 1);
        assert_eq!(search_log(&path, 0, "Err", false).unwrap().total_hits, 2);
        assert_eq!(search_log(&path, 0, "  ", false).unwrap().total_hits, 0);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn search_log_预览剥转义与截宽() {
        /* OSC8 超链接 + CSI 配色混入行内;预览只剩可见文本 */
        let line = b"\x1b]8;;http://x\x1b\\link\x1b]8;;\x1b\\ \x1b[31mRED\x1b[0m tail";
        let path = temp_log("search-esc", line);
        let r = search_log(&path, 0, "red", false).unwrap();
        assert_eq!(r.hits.len(), 1);
        assert_eq!(r.hits[0].line, "link RED tail");
        /* 截宽:240 字符上限 */
        let long = format!("{}{}", "A".repeat(300), " needle");
        let p2 = temp_log("search-wide", long.as_bytes());
        let r2 = search_log(&p2, 0, "needle", false).unwrap();
        assert_eq!(r2.hits[0].line.chars().count(), 240);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&p2);
    }
}
