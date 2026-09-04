//! 项目文件索引 —— composer `@` 补全的候选源。
//!
//! 语义镜像 pi/omp(pi-tui 系)TUI 自己的 `@` 文件发现(bundle `collectFiles` 取证,
//! 见 docs/superpowers/specs/2026-09-04-composer-cli-sourced-suggestions-design.md D3):
//! - 递归 walk,所有层级的 dotfile/dotdir 跳过(hidden);
//! - 吃 `.gitignore` / `.ignore` / `.fdignore`(ignore crate 即 ripgrep 同源引擎);
//! - 追加跳过 `node_modules` 目录段(pi 无条件跳过,gitignore 不一定覆盖);
//! - 符号链接不跟随(默认;pi 会 stat 后下钻,这里保守不跟,避免环与慢盘);
//! - 返回 root 相对 posix 路径,排序保证稳定;cap + 时间预算双闸防慢盘挂死。
//!
//! 内核不理解任何 CLI 格式:这里只是"带 ignore 语义的文件枚举",规则本身与
//! pi/omp 的补全同源是产品对齐,不是协议适配。

use std::path::PathBuf;
use std::time::{Duration, Instant};

use ignore::WalkBuilder;

/// 单次 walk 的时间预算。网络盘/超大仓靠它兜底:超时返回已收集部分(不报错,
/// 上层按"部分索引"消费)。正常仓(≤2 万文件)远快于此。
const WALK_BUDGET: Duration = Duration::from_secs(3);

/// 条目是否该整枝剪掉(目录段级过滤,先于 ignore 语义,和 pi 同款无条件跳过)。
fn pruned(name: &std::ffi::OsStr) -> bool {
    name == std::ffi::OsStr::new("node_modules")
}

/// 递归枚举 root 下的文件(root 相对 posix 路径,排序稳定)。
/// cap = 最大文件数;超 cap 或超时间预算时返回已有部分。
pub fn walk_files(root: &str, cap: usize) -> Result<Vec<String>, String> {
    let root_path = PathBuf::from(root);
    if !root_path.is_dir() {
        return Err(format!("不是目录: {root}"));
    }
    let mut builder = WalkBuilder::new(&root_path);
    builder
        .hidden(true)
        .git_ignore(true)
        // pi 只读各级目录里的 ignore 文件,不读 git 全局 exclude(语义对齐)
        .git_global(false)
        .git_exclude(false)
        // pi 按文件文本生效,不看是否 git 仓库(ignore crate 默认 require_git
        // 会让非 repo 目录的 .gitignore 失效,与 pi 不符)
        .require_git(false)
        .parents(false)
        .add_custom_ignore_filename(".fdignore")
        .filter_entry(|e| e.depth() == 0 || !pruned(e.file_name()));

    let start = Instant::now();
    let mut files: Vec<String> = Vec::with_capacity(1024);
    for entry in builder.build() {
        // 慢盘兜底:预算耗尽即交付部分结果
        if start.elapsed() > WALK_BUDGET || files.len() >= cap {
            break;
        }
        let Ok(entry) = entry else { continue };
        if entry.depth() == 0 {
            continue; // 根自身
        }
        // 文件与目录都入候选(pi/omp 的 @ 菜单两者都列,目录带尾 / 标识)
        let Some(ft) = entry.file_type() else {
            continue;
        };
        if !ft.is_file() && !ft.is_dir() {
            continue; // symlink 等特殊条目不入候选
        }
        let rel: PathBuf = match entry.path().strip_prefix(&root_path) {
            Ok(p) => p.to_path_buf(),
            Err(_) => continue,
        };
        // windows 反斜杠 → posix;与 pi 的 toPosixPath 一致
        let mut text = rel.to_string_lossy().replace('\\', "/");
        if ft.is_dir() {
            text.push('/');
        }
        if !text.is_empty() {
            files.push(text);
        }
    }
    files.sort();
    Ok(files)
}

/// 测试:临时仓 fixture,验 gitignore / dotfiles / node_modules / 相对路径形态。
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn tmp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tmd_walk_{tag}_{}_{}",
            std::process::id(),
            Instant::now().elapsed().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn touch(root: &Path, rel: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, b"x").unwrap();
    }

    #[test]
    fn honors_gitignore_dots_and_node_modules() {
        let root = tmp_root("semantics");
        touch(&root, "src/deep/nested/keep.rs");
        touch(&root, "src/skip-generated.rs");
        touch(&root, "node_modules/pkg/index.js");
        touch(&root, ".hidden/dot.txt");
        touch(&root, ".dotfile");
        std::fs::write(root.join(".gitignore"), b"skip-generated.rs\n").unwrap();

        let files = walk_files(root.to_str().unwrap(), 10_000).unwrap();
        // 目录与文件都入候选,目录带尾 /;ignore/dot/node_modules 语义照抄 pi
        assert_eq!(
            files,
            vec![
                "src/",
                "src/deep/",
                "src/deep/nested/",
                "src/deep/nested/keep.rs"
            ]
        );

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn honors_ignore_and_fdignore_files() {
        let root = tmp_root("ignorefiles");
        touch(&root, "a.md");
        touch(&root, "b.log");
        touch(&root, "c.tmp");
        std::fs::write(root.join(".ignore"), b"*.log\n").unwrap();
        std::fs::write(root.join(".fdignore"), b"*.tmp\n").unwrap();

        let files = walk_files(root.to_str().unwrap(), 10_000).unwrap();
        assert_eq!(files, vec!["a.md"]);

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn cap_limits_output_and_is_stable() {
        let root = tmp_root("cap");
        for i in 0..50 {
            touch(&root, &format!("f{i:02}.txt"));
        }
        let files = walk_files(root.to_str().unwrap(), 10).unwrap();
        assert_eq!(files.len(), 10);
        let mut sorted = files.clone();
        sorted.sort();
        assert_eq!(files, sorted);

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn non_dir_root_is_error() {
        assert!(walk_files("/definitely/not/a/dir/tmd", 10).is_err());
    }
}
