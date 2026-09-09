//! plugins.rs 单元测试(经 plugins.rs 内 #[path] 引入,本文件即 tests 模块本体)。
use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

static SEQ: AtomicU64 = AtomicU64::new(0);

/// 唯一临时插件根(并行测试互不干扰);Drop 时清理。
struct TempRoot(PathBuf);
impl TempRoot {
    fn new() -> Self {
        let n = SEQ.fetch_add(1, Ordering::SeqCst);
        let p = std::env::temp_dir().join(format!("tmd-plugins-test-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        Self(p)
    }
    fn write_plugin(&self, id: &str, manifest: &str, entry: &str) {
        let dir = self.0.join(id);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("plugin.json"), manifest).unwrap();
        fs::write(dir.join("index.js"), entry).unwrap();
    }
    /// 当前入口内容的指纹文件名(与 archive_current 命名规则一致)。
    fn version_name(&self, _id: &str, version: &str, content: &str) -> String {
        version_file_name(version, &crate::hash::sha256_hex(content))
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn manifest(id: &str, version: &str) -> String {
    format!(r#"{{"id":"{id}","name":"t","version":"{version}"}}"#)
}

#[test]
fn scan_empty_when_root_missing_or_empty() {
    let t = TempRoot::new();
    let missing = t.0.join("nope");
    assert_eq!(scan_plugins(&missing).unwrap(), vec![]);
    assert_eq!(scan_plugins(&t.0).unwrap(), vec![]);
}

#[test]
fn scan_skips_dirs_without_manifest_and_hidden() {
    let t = TempRoot::new();
    fs::create_dir_all(t.0.join("junk")).unwrap();
    fs::create_dir_all(t.0.join(".hidden")).unwrap();
    t.write_plugin("good", &manifest("good", "1.0.0"), "export default {};");
    let out = scan_plugins(&t.0).unwrap();
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].id, "good");
    assert!(out[0].error.is_none());
    assert!(out[0].manifest.is_some());
    assert!(out[0].files.iter().any(|f| f.name == "index.js"));
}

#[test]
fn scan_flags_manifest_mismatch_and_bad_json() {
    let t = TempRoot::new();
    t.write_plugin("dir-a", &manifest("other-id", "1.0.0"), "x");
    fs::create_dir_all(t.0.join("dir-b")).unwrap();
    fs::write(t.0.join("dir-b/plugin.json"), "{not json").unwrap();
    let out = scan_plugins(&t.0).unwrap();
    assert_eq!(out.len(), 2);
    assert!(out[0].error.as_deref().unwrap().contains("不一致"));
    assert!(out[1].error.as_deref().unwrap().contains("非法 JSON"));
}

#[test]
fn scan_skips_symlinked_plugin_dir() {
    let t = TempRoot::new();
    #[cfg(unix)]
    {
        // 目标目录藏进隐藏段(扫描本来就跳过隐藏目录),evil 是指向它的软链
        let outside = t.0.join(".outside-target");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("plugin.json"), manifest("evil", "1.0.0")).unwrap();
        std::os::unix::fs::symlink(&outside, t.0.join("evil")).unwrap();
        let out = scan_plugins(&t.0).unwrap();
        assert_eq!(out, vec![]); // 软链插件目录整体跳过
    }
}

#[test]
fn scan_skips_oversize_entry_file() {
    let t = TempRoot::new();
    t.write_plugin("big", &manifest("big", "1.0.0"), "x");
    fs::write(
        t.0.join("big/index.js"),
        vec![b'x'; (MAX_READ_BYTES + 1) as usize],
    )
    .unwrap();
    let out = scan_plugins(&t.0).unwrap();
    // 超限入口不入清单(免信任路径不被大文件拖垮);前端落「入口缺失」不装载
    assert!(!out[0].files.iter().any(|f| f.name == "index.js"));
}

#[test]
fn rejects_traversal_in_id_and_file() {
    let t = TempRoot::new();
    assert!(read_plugin_file(&t.0, "../etc", "index.js").is_err());
    assert!(read_plugin_file(&t.0, "a", "../passwd").is_err());
    assert!(read_plugin_file(&t.0, "a", "a/b.js").is_err());
    assert!(read_version_file(&t.0, "a", "../index.js").is_err());
    assert!(rollback(&t.0, "../x", "f.js").is_err());
    assert!(!valid_name("CON")); // Windows 保留设备名拒绝
    assert!(!valid_name("Nul"));
}

#[test]
fn read_limited_rejects_oversize() {
    let t = TempRoot::new();
    t.write_plugin("big", &manifest("big", "1.0.0"), "x");
    fs::write(
        t.0.join("big/big.js"),
        vec![b'x'; (MAX_READ_BYTES + 1) as usize],
    )
    .unwrap();
    let err = read_plugin_file(&t.0, "big", "big.js").unwrap_err();
    assert!(err.contains("16MB"));
}

#[test]
fn archive_dedupes_by_content_and_prunes_to_keep() {
    let t = TempRoot::new();
    t.write_plugin("p", &manifest("p", "1.0.0"), "export default {v:1};");
    let first = archive_current(&t.0, "p").unwrap();
    assert_eq!(
        first.as_deref(),
        Some(
            t.version_name("p", "1.0.0", "export default {v:1};")
                .as_str()
        )
    );
    // 同内容再归档 → None(去重)
    assert_eq!(archive_current(&t.0, "p").unwrap(), None);
    // 连续变更 6 次 → 版本库只留 5 份
    for i in 0..6 {
        fs::write(
            t.0.join("p/index.js"),
            format!("export default {{{i}}}; // {i}"),
        )
        .unwrap();
        archive_current(&t.0, "p").unwrap();
        // 单调递增 mtime,保证淘汰序稳定
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    let kept = collect_stamps(&t.0, &t.0.join("p/.versions"), false);
    assert_eq!(kept.len(), VERSIONS_KEEP);
}

#[test]
fn archive_dedupes_by_content_across_version_names() {
    let t = TempRoot::new();
    // 1.0.0 内容 c1 先归档
    t.write_plugin("p", &manifest("p", "1.0.0"), "v1");
    archive_current(&t.0, "p").unwrap();
    // 升 2.0.0 后又回退(老版 bug 时代会以 2.0.0 名义把 c1 再归档出孤儿条目)
    fs::write(t.0.join("p/index.js"), "v2").unwrap();
    fs::write(t.0.join("p/plugin.json"), manifest("p", "2.0.0")).unwrap();
    archive_current(&t.0, "p").unwrap();
    fs::write(t.0.join("p/index.js"), "v1").unwrap();
    let archived = archive_current(&t.0, "p").unwrap();
    assert_eq!(archived, None); // 同内容(即使版本段不同名)不再重复归档
    let kept = collect_stamps(&t.0, &t.0.join("p/.versions"), false);
    assert_eq!(kept.len(), 2); // v1、v2 各一份
}

#[test]
fn rollback_archives_current_then_restores() {
    let t = TempRoot::new();
    t.write_plugin("p", &manifest("p", "1.0.0"), "v1");
    archive_current(&t.0, "p").unwrap();
    fs::write(t.0.join("p/index.js"), "v2").unwrap();
    archive_current(&t.0, "p").unwrap();
    // 回退到 v1
    let v1 = t.version_name("p", "1.0.0", "v1");
    rollback(&t.0, "p", &v1).unwrap();
    assert_eq!(fs::read_to_string(t.0.join("p/index.js")).unwrap(), "v1");
    // 回退前的 v2 也已归档,不丢当前版
    let v2 = t.version_name("p", "1.0.0", "v2");
    assert!(t.0.join("p/.versions").join(v2).is_file());
    // 回退不存在的版本 → 报错
    assert!(rollback(&t.0, "p", "9.9.9-deadbeef.js").is_err());
}

#[test]
fn rollback_aligns_manifest_version() {
    let t = TempRoot::new();
    t.write_plugin("p", &manifest("p", "1.0.0"), "v1");
    archive_current(&t.0, "p").unwrap();
    // 升 2.0.0(bundle 与 plugin.json 一起前进)再归档
    fs::write(t.0.join("p/index.js"), "v2").unwrap();
    fs::write(t.0.join("p/plugin.json"), manifest("p", "2.0.0")).unwrap();
    archive_current(&t.0, "p").unwrap();
    // 回退 1.0.0 → plugin.json 版本号同步回退,其余字段保留
    let v1 = t.version_name("p", "1.0.0", "v1");
    rollback(&t.0, "p", &v1).unwrap();
    let v: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(t.0.join("p/plugin.json")).unwrap()).unwrap();
    assert_eq!(v["version"], "1.0.0");
    assert_eq!(v["name"], "t");
}

#[test]
fn trash_plugin_moves_to_trash_and_locks_prefix() {
    let t = TempRoot::new();
    t.write_plugin("p", &manifest("p", "1.0.0"), "x");
    trash_plugin(&t.0, "p").unwrap();
    assert!(!t.0.join("p").exists()); // 已移出(废纸篓)
    assert!(trash_plugin(&t.0, "p").is_err()); // 再删 → 目录不存在
    assert!(trash_plugin(&t.0, "../outside").is_err()); // 前缀锁死
}
