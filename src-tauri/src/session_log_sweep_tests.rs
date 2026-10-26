//! session_log_sweep 单测:temp 目录构造三层树,覆盖 TTL/全清/活保护/
//! 空目录回收/后缀白名单。

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use super::sweep_tree;

/// 唯一 temp 根(进程 id 防并行撞名),drop 时整树清理。
struct TempRoot(PathBuf);

impl TempRoot {
    fn new(name: &str) -> Self {
        let p = std::env::temp_dir().join(format!("tmd-sweep-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        Self(p)
    }

    /// 造一个文件(返回路径);mtime_days 控制 modified 时间。
    fn file(&self, rel: &str, mtime_days_ago: u64) -> PathBuf {
        let p = self.0.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, b"x").unwrap();
        let t = SystemTime::now() - Duration::from_secs(mtime_days_ago * 86_400);
        let f = fs::File::options().append(true).open(&p).unwrap();
        f.set_modified(t).unwrap();
        p
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn ttl_deletes_old_keeps_fresh() {
    let root = TempRoot::new("ttl");
    let old = root.file("omp/proj-a/old.log", 8);
    let fresh = root.file("omp/proj-a/fresh.log", 1);
    let live = HashSet::new();
    let r = sweep_tree(&root.0, 7, &live, SystemTime::now());
    assert_eq!(r.removed_files, 1);
    assert!(!old.exists());
    assert!(fresh.exists());
}

#[test]
fn zero_days_clears_all_but_live() {
    let root = TempRoot::new("zero");
    let live_one = root.file("omp/proj-a/live.log", 30);
    root.file("omp/proj-a/dead.log", 0);
    root.file("omp/proj-b/ptr.logptr", 0);
    let live = HashSet::from([live_one]);
    let r = sweep_tree(&root.0, 0, &live, SystemTime::now());
    assert_eq!(r.removed_files, 2);
    assert!(root.0.join("omp/proj-a/live.log").exists());
    /* proj-a 仍持活文件保留;proj-b 清空后整目录回收。 */
    assert!(root.0.join("omp/proj-a").is_dir());
    assert!(!root.0.join("omp/proj-b").exists());
    assert_eq!(r.removed_dirs, 1);
}

#[test]
fn sweepable_exts_only_and_tmp() {
    let root = TempRoot::new("exts");
    root.file("omp/proj-a/rotate.tmp", 10);
    root.file("omp/proj-a/notes.txt", 10);
    let live = HashSet::new();
    let r = sweep_tree(&root.0, 7, &live, SystemTime::now());
    assert_eq!(r.removed_files, 1);
    assert!(root.0.join("omp/proj-a/notes.txt").exists());
}

#[test]
fn empty_engine_dir_reclaimed() {
    let root = TempRoot::new("engine");
    root.file("grok/only/one.log", 10);
    let live = HashSet::new();
    let r = sweep_tree(&root.0, 7, &live, SystemTime::now());
    assert_eq!(r.removed_files, 1);
    assert!(!root.0.join("grok").exists());
    assert_eq!(r.removed_dirs, 2); /* 项目目录 + 引擎目录 */
}
