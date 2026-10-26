//! 全文搜索 —— rg 式即时扫描原语(spec 2026-09-18 取舍三:不做持久索引)。
//!
//! walk 语义与 fs_walk.rs 完全镜像(hidden / gitignore 系 / require_git(false) /
//! parents(false) / 剪 node_modules / 3s 预算),文件侧护栏照 yn 行为:
//! - >3MB 跳过(大文件不搜);
//! - 首 8KB 含 \0 判二进制跳过;
//! - 单文件命中 cap 100,全局 cap max_results;
//! - 大小写不敏感时 str::to_lowercase 两侧归一(全 Unicode,行为可预期);
//! - include_glob 可选单 glob 过滤(basename 简单匹配,见 glob_match);
//! - 空 query 直接返回空(前端不触发,这里是契约兜底)。

use std::path::PathBuf;
use std::time::{Duration, Instant};

use ignore::WalkBuilder;
use serde::Serialize;

/// 搜索命中:path 为 root 相对 posix 路径,line 1 基,text 已去行尾换行。
#[derive(Serialize, PartialEq, Debug)]
pub struct FsSearchHit {
    pub path: String,
    pub line: u32,
    pub text: String,
}

/// 搜索交付:truncated = 3s 预算耗尽或满额,结果不完整(UI 提示用)。
#[derive(Serialize, PartialEq, Debug)]
pub struct FsSearchResult {
    pub hits: Vec<FsSearchHit>,
    pub truncated: bool,
}

/// 单次搜索的时间预算(与 fs_walk 同款):超时交付已收集部分。
const WALK_BUDGET: Duration = Duration::from_secs(3);
/// 文件大小闸:超过即跳过(yn 同款 3MB)。
const MAX_FILE_SIZE: u64 = 3 * 1024 * 1024;
/// 二进制探测窗:首 8KB 含 \0 判二进制。
const BINARY_SNIFF: usize = 8 * 1024;
/// 单文件命中上限:防单个大匹配文件淹没全局结果。
const PER_FILE_CAP: usize = 100;

/// 目录段级过滤(与 fs_walk::pruned 同款,无条件剪)。
fn pruned(name: &std::ffi::OsStr) -> bool {
    name == std::ffi::OsStr::new("node_modules")
}

/// 单 glob 简单匹配(不引依赖):对 basename 生效(rg -g 无斜杠同族)——
/// 按 '*' 分段,段按序出现即可(段间可跨字符):首段锚定开头、末段锚定结尾,
/// 缺侧不锚。覆盖 '*.ts' 后缀 / 'foo*' 前缀 / 'foo' 全名 / '*foo*' / '*.d.*'
/// 含子串。正则不在本面(Cargo 无 regex 依赖,如实收缩)。
fn glob_match(glob: &str, name: &str) -> bool {
    let mut rest = name;
    for (i, seg) in glob.split('*').enumerate() {
        if i == 0 {
            if !rest.starts_with(seg) {
                return false;
            }
            rest = &rest[seg.len()..];
        } else if let Some(pos) = rest.find(seg) {
            rest = &rest[pos + seg.len()..];
        } else {
            return false;
        }
    }
    glob.ends_with('*') || rest.is_empty()
}

/// 即时全文搜索:字面匹配(非正则,v1 覆盖绝大多数用法)。
/// 逐行扫描,行文本去尾部 \r\n;命中按 walk 序返回(同文件行序自然递增)。
/// include_glob:可选单 glob,basename 匹配(空/空白 = 不过滤)。
pub fn search(
    root: &str,
    query: &str,
    case_sensitive: bool,
    include_glob: Option<&str>,
    max_results: usize,
) -> Result<FsSearchResult, String> {
    if query.is_empty() || max_results == 0 {
        return Ok(FsSearchResult {
            hits: Vec::new(),
            truncated: false,
        });
    }
    let root_path = PathBuf::from(root);
    if !root_path.is_dir() {
        return Err(format!("不是目录: {root}"));
    }
    // 大小写归一只做一次,行侧逐行归一
    let needle = if case_sensitive {
        query.to_string()
    } else {
        query.to_lowercase()
    };
    let glob = include_glob.map(str::trim).filter(|g| !g.is_empty());

    let mut builder = WalkBuilder::new(&root_path);
    builder
        .hidden(true)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(false)
        .require_git(false)
        .parents(false)
        .add_custom_ignore_filename(".fdignore")
        .filter_entry(|e| e.depth() == 0 || !pruned(e.file_name()));

    let start = Instant::now();
    let mut hits: Vec<FsSearchHit> = Vec::new();
    let mut truncated = false;
    for entry in builder.build() {
        // 慢盘兜底:预算耗尽或全局满额即交付部分结果(不完整,置 truncated)
        if start.elapsed() > WALK_BUDGET || hits.len() >= max_results {
            truncated = true;
            break;
        }
        let Ok(entry) = entry else { continue };
        if entry.depth() == 0 {
            continue; // 根自身
        }
        let Some(ft) = entry.file_type() else {
            continue;
        };
        if !ft.is_file() {
            continue; // 搜索只吃文件;symlink 等特殊条目同 fs_walk 不入
        }
        if entry
            .metadata()
            .map(|m| m.len() > MAX_FILE_SIZE)
            .unwrap_or(true)
        {
            continue; // 大文件跳过;元数据读不到也跳过(读正文同样会失败)
        }
        let Ok(rel) = entry.path().strip_prefix(&root_path) else {
            continue;
        };
        let path = rel.to_string_lossy().replace('\\', "/");
        if let Some(g) = glob {
            let name = path.rsplit('/').next().unwrap_or(&path);
            if !glob_match(g, name) {
                continue; // glob 不符:整文件跳过(rg -g 同语义)
            }
        }
        let Ok(bytes) = std::fs::read(entry.path()) else {
            continue;
        };
        if bytes[..bytes.len().min(BINARY_SNIFF)].contains(&0) {
            continue; // 二进制
        }
        let file_start = hits.len();
        /* 行游标切行:\n 与独立 \r 都断行,CRLF(\r\n)视作单一换行 ——
        naive split(\n|\r) 会给 CRLF 文本拆出幻影空行,行号错位。
        与 CodeMirror(lezer)的 CR/CR-LF/LF 三态换行语义对齐。 */
        let mut line_no: u32 = 0;
        let mut pos = 0usize;
        while pos < bytes.len() {
            line_no += 1;
            let rest = &bytes[pos..];
            let (raw, next) = match rest.iter().position(|&b| b == b'\n' || b == b'\r') {
                Some(i) => {
                    let end = pos + i;
                    let mut nxt = end + 1;
                    if bytes[end] == b'\r' && nxt < bytes.len() && bytes[nxt] == b'\n' {
                        nxt += 1; // CRLF 合一
                    }
                    (&bytes[pos..end], nxt)
                }
                None => (rest, bytes.len()),
            };
            if hits.len() - file_start >= PER_FILE_CAP || hits.len() >= max_results {
                break;
            }
            let text = String::from_utf8_lossy(raw); // 合法 UTF-8 零拷贝
            let matched = if case_sensitive {
                text.contains(needle.as_str())
            } else {
                text.to_lowercase().contains(&needle)
            };
            if matched {
                hits.push(FsSearchHit {
                    path: path.clone(),
                    line: line_no,
                    text: text.into_owned(),
                });
            }
            pos = next;
        }
    }
    /* walk 自然走完但已满额:命中恰在最后文件时内层 break 未触发,结果实际
     * 不完整(后面无文件可证伪),同样置 truncated(UI 不谎报完整)。 */
    if hits.len() >= max_results {
        truncated = true;
    }
    Ok(FsSearchResult { hits, truncated })
}

#[cfg(test)]
#[path = "fs_search_tests.rs"]
mod tests;
