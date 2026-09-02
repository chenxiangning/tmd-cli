//! checkpoints 集成测试 —— TempWs(临时用户仓库 + 隔离 sidecar 根)。
//! 并行隔离:所有测试持全局 IO 锁(TEST_BASE 是进程级单例)。

use super::{capture_snapshot, capture::SnapKind, derive_batches, prune, restore_batch, undo_revert, set_base_for_test};
use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

static SEQ: AtomicU64 = AtomicU64::new(0);

fn io_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    // 测试 panic 会毒化锁;忽略毒化,让后续测试继续(各自有独立 TempWs)
    LOCK.get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|p| p.into_inner())
}

struct TempWs {
    dir: std::path::PathBuf,
    _guard: std::sync::MutexGuard<'static, ()>,
}

impl TempWs {
    fn new() -> Self {
        let guard = io_lock();
        let seq = SEQ.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("tmd-ckpt-test-{}-{seq}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let repo = git2::Repository::init(&dir).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "t").unwrap();
        cfg.set_str("user.email", "t@t").unwrap();
        drop(cfg);
        let base = std::env::temp_dir().join(format!("tmd-ckpt-store-{}-{seq}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        set_base_for_test(base);
        Self { dir, _guard: guard }
    }

    fn path(&self) -> &str {
        self.dir.to_str().unwrap()
    }

    fn write(&self, name: &str, content: &str) {
        let full = self.dir.join(name);
        if let Some(p) = full.parent() {
            fs::create_dir_all(p).unwrap();
        }
        fs::write(full, content).unwrap();
    }

    fn read(&self, name: &str) -> Option<String> {
        fs::read_to_string(self.dir.join(name)).ok()
    }

    fn commit_all(&self, msg: &str) {
        let repo = git2::Repository::open(&self.dir).unwrap();
        let mut index = repo.index().unwrap();
        index
            .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
            .unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = repo.signature().unwrap();
        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let mut parents = Vec::new();
        if let Some(p) = &parent {
            parents.push(p);
        }
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &parents).unwrap();
    }

    fn anchor(&self, sid: &str, prompt: &str) -> super::Snapshot {
        capture_snapshot(self.path(), sid, prompt, SnapKind::Anchor).unwrap()
    }
}

impl Drop for TempWs {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn 快照往返_批推导_diff_回退_反悔() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    // 第 1 批:A(v2 + 新文件 b)→ B(a 改 v3)
    ws.write("a.txt", "v2\n");
    ws.write("b.txt", "hello\n");
    let a = ws.anchor("s1", "第一批");
    ws.write("a.txt", "v3\n");
    let b = ws.anchor("s1", "第二批");
    assert_ne!(a.id, b.id);

    let batches = derive_batches(ws.path(), "s1").unwrap();
    assert_eq!(batches.len(), 1, "b.txt 两锚点间未变,不入批");
    let batch = &batches[0];
    assert_eq!(batch.id, a.id);
    assert_eq!(batch.index, 1);
    assert!(!batch.open);
    assert_eq!(batch.state, "pending");
    assert_eq!(batch.files.len(), 1);
    let f = &batch.files[0];
    assert_eq!(f.path, "a.txt");
    assert_eq!(f.status, "M");
    assert_eq!(f.live, "same", "当前内容 == 批后像,可回退");
    assert!(!f.stale);

    // diff:v2 → v3
    let patches = super::batch_patches(ws.path(), &a.id).unwrap();
    assert_eq!(patches.len(), 1);
    assert_eq!(patches[0].kind, "M");
    assert!(patches[0].patch.contains("-v2"));
    assert!(patches[0].patch.contains("+v3"));

    // 回退整批 → a.txt 回到 v2;state=reverted;守卫存在
    let out = restore_batch(ws.path(), &a.id, None).unwrap();
    assert_eq!(out.restored, vec!["a.txt".to_string()]);
    assert_eq!(out.state, "reverted");
    assert!(out.guard_id.is_some());
    assert_eq!(ws.read("a.txt").as_deref(), Some("v2\n"));

    // 反悔 → 回到 v3(守卫内容),state 回 pending
    let undo = undo_revert(ws.path(), &a.id).unwrap();
    assert_eq!(undo.restored, vec!["a.txt".to_string()]);
    assert_eq!(ws.read("a.txt").as_deref(), Some("v3\n"));
    let batches = derive_batches(ws.path(), "s1").unwrap();
    assert_eq!(batches[0].state, "pending");
}

#[test]
fn 批内新建文件_回退即删除() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a = ws.anchor("s1", "锚1");
    ws.write("new/nested.txt", "created\n");
    ws.anchor("s1", "锚2");

    let batches = derive_batches(ws.path(), "s1").unwrap();
    assert_eq!(batches.len(), 1);
    let f = &batches[0].files[0];
    assert_eq!(f.path, "new/nested.txt");
    assert_eq!(f.status, "A");

    let out = restore_batch(ws.path(), &a.id, None).unwrap();
    assert_eq!(out.deleted, vec!["new/nested.txt".to_string()]);
    assert!(ws.read("new/nested.txt").is_none(), "批内新建文件,回退 = 删除");
}

#[test]
fn 内容失配_自动已处理且回退被拒() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a = ws.anchor("s1", "锚1");
    ws.write("a.txt", "v2\n");
    ws.anchor("s1", "锚2");
    // 批后用户手改
    ws.write("a.txt", "hand-edited\n");

    let batches = derive_batches(ws.path(), "s1").unwrap();
    assert_eq!(batches[0].state, "done");
    assert_eq!(batches[0].done_reason.as_deref(), Some("内容已变"));
    assert!(batches[0].files[0].stale);

    let err = restore_batch(ws.path(), &a.id, None).unwrap_err();
    assert!(err.to_string().starts_with("E_EMPTY:"), "失配文件不可回退: {err}");
}

#[test]
fn 用户提交_自动已处理_理由已提交() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let _a = ws.anchor("s1", "锚1");
    ws.write("a.txt", "v2\n");
    ws.anchor("s1", "锚2");
    // 用户 stage+commit 批内文件
    ws.write("a.txt", "v2\n");
    ws.commit_all("keep batch work");

    let batches = derive_batches(ws.path(), "s1").unwrap();
    assert_eq!(batches[0].state, "done");
    assert_eq!(batches[0].done_reason.as_deref(), Some("已提交"));
}

#[test]
fn 单文件回退_批留在待审_全处理完才翻已退() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.write("c.txt", "c1\n");
    ws.commit_all("init");

    let a = ws.anchor("s1", "锚1");
    ws.write("a.txt", "v2\n");
    ws.write("c.txt", "c2\n");
    ws.anchor("s1", "锚2");

    let out = restore_batch(ws.path(), &a.id, Some(vec!["a.txt".into()])).unwrap();
    assert_eq!(out.state, "pending", "还有一个文件未处理");
    assert_eq!(ws.read("a.txt").as_deref(), Some("v1\n"));
    assert_eq!(ws.read("c.txt").as_deref(), Some("c2\n"));

    let batches = derive_batches(ws.path(), "s1").unwrap();
    let files = &batches[0].files;
    assert!(files.iter().find(|f| f.path == "a.txt").unwrap().reverted);
    assert!(!files.iter().find(|f| f.path == "c.txt").unwrap().reverted);

    restore_batch(ws.path(), &a.id, Some(vec!["c.txt".into()])).unwrap();
    let batches = derive_batches(ws.path(), "s1").unwrap();
    assert_eq!(batches[0].state, "reverted", "全部文件处理完 → 已退");
}

#[test]
fn prune_保留最近_n_批() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a1 = ws.anchor("s1", "锚1");
    ws.write("a.txt", "v2\n");
    let a2 = ws.anchor("s1", "锚2");
    ws.write("a.txt", "v3\n");
    let _a3 = ws.anchor("s1", "锚3");

    let dropped = prune(ws.path(), 2, 30).unwrap();
    assert_eq!(dropped, 1);
    // 保 2 个锚点(a2,a3) → 只剩 a2→a3 一批;a1 已随锚点清理
    let batches = derive_batches(ws.path(), "s1").unwrap();
    assert_eq!(batches.len(), 1);
    assert!(!batches.iter().any(|b| b.id == a1.id), "最老批被清理");
    assert!(batches.iter().any(|b| b.id == a2.id));
}

#[test]
fn 非_ascii_路径_往返无损() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a = ws.anchor("s1", "锚1");
    ws.write("目录/中文文件.txt", "内容\n");
    ws.anchor("s1", "锚2");

    let batches = derive_batches(ws.path(), "s1").unwrap();
    assert_eq!(batches[0].files[0].path, "目录/中文文件.txt");
    restore_batch(ws.path(), &a.id, None).unwrap();
    assert!(ws.read("目录/中文文件.txt").is_none());
    undo_revert(ws.path(), &a.id).unwrap();
    assert_eq!(ws.read("目录/中文文件.txt").as_deref(), Some("内容\n"));
}

#[test]
fn 会话严格隔离_新会话看不到历史批次() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    // 会话 A 两轮,产生一个批次
    let a = ws.anchor("sess-a", "A 第一轮");
    ws.write("a.txt", "v2\n");
    ws.anchor("sess-a", "A 第二轮");

    // 会话 B 视角:零批次(哪怕工作区是脏的)
    let for_b = derive_batches(ws.path(), "sess-b").unwrap();
    assert!(for_b.is_empty(), "其他会话不得看到 A 的批次");
    let for_b2 = derive_batches(ws.path(), "sess-new").unwrap();
    assert!(for_b2.is_empty(), "全新会话从零开始");

    // 会话 A 视角:批次仍在,且回退/反悔生命周期不受 B 影响
    let for_a = derive_batches(ws.path(), "sess-a").unwrap();
    assert_eq!(for_a.len(), 1);
    assert_eq!(for_a[0].id, a.id);
    restore_batch(ws.path(), &a.id, None).unwrap();
    assert_eq!(ws.read("a.txt").as_deref(), Some("v1\n"));
}

#[test]
fn 非_git_目录_报_not_a_repo() {
    let _g = io_lock();
    let seq = SEQ.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("tmd-ckpt-nogit-{}-{seq}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let base = dir.join("store");
    fs::create_dir_all(&base).unwrap();
    set_base_for_test(base);
    let err = capture_snapshot(dir.to_str().unwrap(), "s", "p", SnapKind::Anchor).unwrap_err();
    assert!(err.to_string().starts_with("E_NOT_A_REPO:"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn 通过标记_纯标记_不阻回退() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a = ws.anchor("s1", "锚1");
    ws.write("a.txt", "v2\n");
    ws.anchor("s1", "锚2");

    // 未通过:pending
    assert_eq!(derive_batches(ws.path(), "s1").unwrap()[0].state, "pending");

    // 通过 = 纯标记:文件内容不变,状态翻 approved
    super::approve_batch(ws.path(), &a.id).unwrap();
    assert_eq!(ws.read("a.txt").as_deref(), Some("v2\n"), "通过不得动文件");
    assert_eq!(
        derive_batches(ws.path(), "s1").unwrap()[0].state,
        "approved"
    );

    // approved 批仍可回退(标记弱于安全动作)
    let out = restore_batch(ws.path(), &a.id, None).unwrap();
    assert_eq!(out.state, "reverted");
    assert_eq!(ws.read("a.txt").as_deref(), Some("v1\n"));

    // 已回退批不可再标记通过
    assert!(super::approve_batch(ws.path(), &a.id).is_err());

    // 反悔后:标记已被回退动作清除,回到 pending
    undo_revert(ws.path(), &a.id).unwrap();
    assert_eq!(derive_batches(ws.path(), "s1").unwrap()[0].state, "pending");
}
