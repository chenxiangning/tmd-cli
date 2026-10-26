//! fs_search.rs 的单元测试(文件规模铁则拆出;经 #[path] 挂回 fs_search::tests)。

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

/// 收集命中 path(walk 序不稳定,断言前排序)。
fn hit_paths(root: &str, query: &str, glob: Option<&str>) -> Vec<String> {
    let mut paths: Vec<String> = search(root, query, true, glob, 100)
        .unwrap()
        .hits
        .into_iter()
        .map(|h| h.path)
        .collect();
    paths.sort();
    paths
}

#[test]
fn hits_line_numbers_and_text_trim() {
    let root = tmp_root("hits");
    write(&root, "a.txt", b"hello world\nSECOND line\r\nthird hello\n");
    let hits = search(root.to_str().unwrap(), "hello", true, None, 100)
        .unwrap()
        .hits;
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
    let hits = search(root.to_str().unwrap(), "foo", false, None, 100)
        .unwrap()
        .hits;
    assert_eq!(hits.len(), 3);
    // 敏感:仅精确一例
    let hits = search(root.to_str().unwrap(), "foo", true, None, 100)
        .unwrap()
        .hits;
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
    late.extend(std::iter::repeat_n(b'a', BINARY_SNIFF));
    late.extend_from_slice(b"\0match");
    write(&root, "late.txt", &late);
    // node_modules 整枝剪掉
    write(&root, "node_modules/pkg/index.js", b"match");
    let hits = search(root.to_str().unwrap(), "match", true, None, 100)
        .unwrap()
        .hits;
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
    let hits = search(root.to_str().unwrap(), "x", true, None, 1000)
        .unwrap()
        .hits;
    assert_eq!(hits.len(), 100);
    // 全局 cap:跨文件也截
    write(&root, "few.txt", b"x\nx\n");
    let hits = search(root.to_str().unwrap(), "x", true, None, 3)
        .unwrap()
        .hits;
    assert_eq!(hits.len(), 3);
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn empty_query_and_bad_root() {
    let root = tmp_root("empty");
    assert!(search(root.to_str().unwrap(), "", true, None, 100)
        .unwrap()
        .hits
        .is_empty());
    assert!(search("/definitely/not/a/dir/tmd", "q", true, None, 100).is_err());
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn include_glob_basename_branches() {
    let root = tmp_root("glob");
    write(&root, "a.ts", b"hit\n");
    write(&root, "b.txt", b"hit\n");
    write(&root, "sub/c.ts", b"hit\n");
    write(&root, "sub/deep.d.ts", b"hit\n");
    let root = root.to_str().unwrap();
    // 后缀:任意深度 basename 命中(含嵌套与双后缀)
    assert_eq!(
        hit_paths(root, "hit", Some("*.ts")),
        vec![
            "a.ts".to_string(),
            "sub/c.ts".to_string(),
            "sub/deep.d.ts".to_string()
        ]
    );
    // 前缀
    assert_eq!(
        hit_paths(root, "hit", Some("b*")),
        vec!["b.txt".to_string()]
    );
    // 全名(无 '*':精确等值)
    assert_eq!(
        hit_paths(root, "hit", Some("b.txt")),
        vec!["b.txt".to_string()]
    );
    assert_eq!(
        hit_paths(root, "hit", Some("*.d.*")),
        vec!["sub/deep.d.ts".to_string()]
    );
    // 空/空白 = 不过滤;'*a*' 含子串:仅 a.ts 命中
    assert_eq!(hit_paths(root, "hit", Some("")).len(), 4);
    assert_eq!(hit_paths(root, "hit", Some("   ")).len(), 4);
    assert_eq!(
        hit_paths(root, "hit", Some("*a*")),
        vec!["a.ts".to_string()]
    );
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn glob_match_direct_table() {
    // (glob, name, 期望)直达:覆盖 starts/ends 重叠与空段边界。
    let cases: &[(&str, &str, bool)] = &[
        ("*.ts", "x.ts", true),
        ("*.ts", "x.tsx", false),
        ("*.ts", "ts", false),
        ("ts*", "ts", true),
        ("ab*ba", "aba", false), // 前后缀重叠:长度闸拒绝
        ("ab*ba", "abba", true),
        ("", "anything", false), // 空 glob 由 search 侧提前滤掉,直连=全名比对
        ("Makefile", "Makefile", true),
        ("Makefile", "makefile", false),
        ("*.d.*", "deep.d.ts", true),
        ("*d*", "abc", false),
        ("t*s", "ts", true),
    ];
    for (g, n, want) in cases {
        assert_eq!(glob_match(g, n), *want, "glob={g:?} name={n:?}");
    }
}
