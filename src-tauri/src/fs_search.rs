//! 全文搜索 —— rg 式即时扫描原语(spec 2026-09-18 取舍三:不做持久索引)。
//!
//! walk 语义与 fs_walk.rs 完全镜像(hidden / gitignore 系 / require_git(false) /
//! parents(false) / 剪 node_modules / 3s 预算),文件侧护栏照 yn 行为:
//! - >3MB 跳过(大文件不搜);
//! - 首 8KB 含 \0 判二进制跳过;
//! - 单文件命中 cap 100,全局 cap max_results;
//! - 大小写不敏感时 str::to_lowercase 两侧归一(全 Unicode,行为可预期);
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

/// 即时全文搜索:字面匹配(非正则,v1 覆盖绝大多数用法)。
/// 逐行扫描,行文本去尾部 \r\n;命中按 walk 序返回(同文件行序自然递增)。
pub fn search(
    root: &str,
    query: &str,
    case_sensitive: bool,
    max_results: usize,
) -> Result<Vec<FsSearchHit>, String> {
    if query.is_empty() || max_results == 0 {
        return Ok(Vec::new());
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
    for entry in builder.build() {
        // 慢盘兜底:预算耗尽或全局满额即交付部分结果
        if start.elapsed() > WALK_BUDGET || hits.len() >= max_results {
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
        let Ok(bytes) = std::fs::read(entry.path()) else {
            continue;
        };
        if bytes[..bytes.len().min(BINARY_SNIFF)].contains(&0) {
            continue; // 二进制
        }
        let file_start = hits.len();
        for (idx, raw) in bytes.split(|&b| b == b'\n').enumerate() {
            if hits.len() - file_start >= PER_FILE_CAP || hits.len() >= max_results {
                break;
            }
            let raw = raw.strip_suffix(b"\r").unwrap_or(raw); // CRLF 归一
            let text = String::from_utf8_lossy(raw); // 合法 UTF-8 零拷贝
            let matched = if case_sensitive {
                text.contains(query)
            } else {
                text.to_lowercase().contains(&needle)
            };
            if matched {
                hits.push(FsSearchHit {
                    path: path.clone(),
                    line: idx as u32 + 1,
                    text: text.into_owned(),
                });
            }
        }
    }
    Ok(hits)
}

/// 测试:临时目录 fixture(与 fs_walk.rs 测试同款纪律)。
#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tmd_search_{tag}_{}_{}",
            std::process::id(),
            Instant::now().elapsed().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(root: &std::path::Path, rel: &str, content: &[u8]) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, content).unwrap();
    }

    #[test]
    fn hits_line_numbers_and_text_trim() {
        let root = tmp_root("hits");
        write(&root, "a.txt", b"hello world\nSECOND line\r\nthird hello\n");
        let hits = search(root.to_str().unwrap(), "hello", true, 100).unwrap();
        assert_eq!(
            hits,
            vec![
                FsSearchHit {
                    path: "a.txt".into(),
                    line: 1,
                    text: "hello world".into()
                },
                FsSearchHit {
                    path: "a.txt".into(),
                    line: 3,
                    text: "third hello".into()
                },
            ]
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn case_sensitivity_flag() {
        let root = tmp_root("case");
        write(&root, "a.txt", b"Foo\nfoo\nFOO\nbar\n");
        // 不敏感:前三行全命中
        let hits = search(root.to_str().unwrap(), "foo", false, 100).unwrap();
        assert_eq!(hits.len(), 3);
        // 敏感:仅精确一例
        let hits = search(root.to_str().unwrap(), "foo", true, 100).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 2);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn binary_and_ignore_semantics_skip() {
        let root = tmp_root("binary");
        // 首 8KB 内含 \0:跳过
        write(&root, "bin.dat", b"match\0 rest");
        // \0 在探测窗之外:正文照搜
        let mut late = b"match".to_vec();
        late.extend(std::iter::repeat(b'a').take(BINARY_SNIFF));
        late.extend_from_slice(b"\0match");
        write(&root, "late.txt", &late);
        // node_modules 整枝剪掉
        write(&root, "node_modules/pkg/index.js", b"match");
        let hits = search(root.to_str().unwrap(), "match", true, 100).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "late.txt");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn caps_limit_results() {
        let root = tmp_root("cap");
        // 单文件超 100 命中:截到 100
        let many = "x\n".repeat(150);
        write(&root, "many.txt", many.as_bytes());
        let hits = search(root.to_str().unwrap(), "x", true, 1000).unwrap();
        assert_eq!(hits.len(), 100);
        // 全局 cap:跨文件也截
        write(&root, "few.txt", b"x\nx\n");
        let hits = search(root.to_str().unwrap(), "x", true, 3).unwrap();
        assert_eq!(hits.len(), 3);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn empty_query_and_bad_root() {
        let root = tmp_root("empty");
        assert!(search(root.to_str().unwrap(), "", true, 100)
            .unwrap()
            .is_empty());
        assert!(search("/definitely/not/a/dir/tmd", "q", true, 100).is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
