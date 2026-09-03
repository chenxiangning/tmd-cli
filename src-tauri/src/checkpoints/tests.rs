//! checkpoints 集成测试 —— TempWs(临时用户仓库 + 隔离账本根)。
//! 并行隔离:所有测试持全局 IO 锁(TEST_BASE 是进程级单例)。
//!
//! 账本模型核心契约:
//!   - 每轮绑定 = 封口瞬间固化的 turn 条目,list 只读不推导
//!   - 纯阅读轮不产生条目,轮次号保持真实(缺号可见)
//!   - 并行会话:先封口者认领路径,另一会话不再重复归属
//!   - CLI 身份回填:tmd id 名下的历史条目并入绑定后的 CLI id 链

use super::{anchor_turn, append_ledger, batch_patches, derive_batches, prune, restore_batch, seal_turn, undo_revert, approve_batch, set_base_for_test};
use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

static SEQ: AtomicU64 = AtomicU64::new(0);

mod dead;
mod events;
mod parallel;

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

    /// 记锚点:session_id = 会话身份,tmd_session_id = tmd 侧 id(同一会话恒定)。
    fn anchor(&self, sid: &str, tmd: &str, prompt: &str) -> super::LedgerEntry {
        anchor_turn(self.path(), sid, tmd, prompt, "", "", "", "git").unwrap()
    }

    /// 记带状态快照的锚点(引擎/模型/思考强度随批固化契约)。
    fn anchor_meta(&self, sid: &str, tmd: &str, prompt: &str, engine: &str, model: &str, thinking: &str) -> super::LedgerEntry {
        anchor_turn(self.path(), sid, tmd, prompt, engine, model, thinking, "git").unwrap()
    }

    fn seal(&self, sid: &str, tmd: &str) -> bool {
        seal_turn(self.path(), sid, tmd).unwrap()
    }

    fn batches(&self, sid: &str) -> Vec<super::BatchInfo> {
        derive_batches(self.path(), sid, "").unwrap()
    }
}

impl Drop for TempWs {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(self.path());
    }
}

#[test]
fn 轮次归因_每轮只绑本窗口变更() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    // 第 1 轮:改 a.txt → 封口
    let a1 = ws.anchor("cli-1", "tmd-1", "第一轮");
    ws.write("a.txt", "v2\n");
    assert!(ws.seal("cli-1", "tmd-1"), "有变更应落账");

    // 第 2 轮:不动文件(纯阅读)→ 不产生条目
    ws.anchor("cli-1", "tmd-1", "第二轮");
    assert!(!ws.seal("cli-1", "tmd-1"), "纯阅读轮零条目");

    // 第 3 轮:新建 b.txt → 封口(带状态快照:引擎/模型/思考随批固化)
    ws.anchor_meta("cli-1", "tmd-1", "第三轮", "Claude Code", "glm-5.3", "high");
    ws.write("b.txt", "hello\n");
    assert!(ws.seal("cli-1", "tmd-1"));

    let batches = ws.batches("cli-1");
    assert_eq!(batches.len(), 2, "纯阅读轮不出现在时间线");
    // 倒序:最新在前
    assert_eq!(batches[0].index, 3, "轮次号 = 账本记录的真实轮次(缺号可见)");
    assert_eq!(batches[0].files.len(), 1);
    assert_eq!(batches[0].files[0].path, "b.txt");
    assert_eq!(batches[0].files[0].status, "A");
    assert!(!batches[0].open);
    assert_eq!(batches[0].engine, "Claude Code", "锚点快照随批固化");
    assert_eq!(batches[0].model, "glm-5.3");
    assert_eq!(batches[0].thinking, "high");
    assert_eq!(batches[1].index, 1, "第 2 轮缺号,编号不重排");
    assert_eq!(batches[1].files.len(), 1);
    assert_eq!(batches[1].files[0].path, "a.txt");
    assert_eq!(batches[1].files[0].status, "M");
    assert_eq!(batches[1].files[0].live, "same", "内容 == 批后像,可回退");
    assert_eq!(batches[1].engine, "", "无快照锚点(旧账本)三字段为空串");
    assert_eq!(batches[1].model, "");
    assert_eq!(batches[1].thinking, "");

    // 账本固化的 diff 可直接读:a.txt v1 → v2
    let patches = batch_patches(ws.path(), &a1.id).unwrap();
    assert_eq!(patches.len(), 1);
    assert!(patches[0].patch.contains("-v1"));
    assert!(patches[0].patch.contains("+v2"));
}

#[test]
fn open_轮_只列本窗口变更_结算前可见() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    // 工作区先有一份历史脏改动(pre-existing)
    ws.write("legacy.txt", "old-dirty\n");

    let a = ws.anchor("cli-1", "tmd-1", "第一轮");
    // 本轮才改 a.txt
    ws.write("a.txt", "v2\n");

    let batches = ws.batches("cli-1");
    assert_eq!(batches.len(), 1, "legacy 脏文件未动,不得入本轮");
    assert!(batches[0].open);
    assert_eq!(batches[0].files.len(), 1);
    assert_eq!(batches[0].files[0].path, "a.txt");

    // open 轮 diff:新像 = live
    let patches = batch_patches(ws.path(), &a.id).unwrap();
    assert_eq!(patches.len(), 1);
    assert!(patches[0].patch.contains("v2"));

    // 封口后:turn 条目固化,内容与 open 视图一致
    assert!(ws.seal("cli-1", "tmd-1"));
    let batches = ws.batches("cli-1");
    assert!(!batches[0].open);
    assert_eq!(batches[0].files.len(), 1);
}

#[test]
fn 封口修订_再改再封_最后一行为准() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a = ws.anchor("cli-1", "tmd-1", "第一轮");
    ws.write("a.txt", "v2\n");
    assert!(ws.seal("cli-1", "tmd-1"));
    // 结算后(下一锚点前)又改:修订封口,账本取最后一行
    ws.write("a.txt", "v3\n");
    assert!(ws.seal("cli-1", "tmd-1"));

    let batches = ws.batches("cli-1");
    assert_eq!(batches[0].files.len(), 1);
    let patches = batch_patches(ws.path(), &a.id).unwrap();
    assert!(patches[0].patch.contains("+v3"), "修订后 diff = 全窗口累计");
    assert!(!patches[0].patch.contains("+v2"));
}

#[test]
fn 会话严格隔离_新会话从零开始() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    ws.anchor("sess-a", "tmd-a", "A 第一轮");
    ws.write("a.txt", "v2\n");
    ws.seal("sess-a", "tmd-a");

    assert!(ws.batches("sess-b").is_empty(), "其他会话不得看到 A 的批次");
    assert!(ws.batches("sess-new").is_empty(), "全新会话从零开始");
    assert_eq!(ws.batches("sess-a").len(), 1);
}

#[test]
fn cli身份回填_tmd名下历史并入绑定链() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    // 首条 prompt:CLI 身份未绑,整链记在 tmd id 名下
    let a1 = ws.anchor("tmd-1", "tmd-1", "第一轮");
    ws.write("a.txt", "v2\n");
    assert!(ws.seal("tmd-1", "tmd-1"));

    // 绑定后:同一会话以 (cli-1, tmd-1) 继续
    let a2 = ws.anchor("cli-1", "tmd-1", "第二轮");
    assert_eq!(a2.turn, 2, "轮次接续不重排");

    let batches = derive_batches(ws.path(), "cli-1", "tmd-1").unwrap();
    assert_eq!(batches.len(), 1, "回填后按 CLI id 一查到底(第 2 轮纯阅读不出现)");
    assert_eq!(batches[0].id, a1.id);
    assert_eq!(batches[0].index, 1);

    // 回退经 CLI id 链照常工作:还原到第 1 轮锚点之前的内容 v1
    let out = restore_batch(ws.path(), &a1.id, None).unwrap();
    assert_eq!(out.restored, vec!["a.txt".to_string()]);
    assert_eq!(ws.read("a.txt").as_deref(), Some("v1\n"));
}

#[test]
fn 轮内新建_回退即删除_反悔恢复() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a = ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("new/nested.txt", "created\n");
    ws.write("a.txt", "v2\n");
    ws.seal("cli-1", "tmd-1");

    let batches = ws.batches("cli-1");
    assert_eq!(batches[0].files.len(), 2);

    let out = restore_batch(ws.path(), &a.id, None).unwrap();
    assert_eq!(out.deleted, vec!["new/nested.txt".to_string()], "轮内新建,回退 = 删除");
    assert_eq!(out.restored, vec!["a.txt".to_string()]);
    assert_eq!(out.state, "reverted");
    assert!(out.guard_id.is_some());
    assert!(ws.read("new/nested.txt").is_none());
    assert_eq!(ws.read("a.txt").as_deref(), Some("v1\n"));

    // 反悔 → 守卫条目写回回退前状态
    let undo = undo_revert(ws.path(), &a.id).unwrap();
    assert_eq!(undo.restored.len() + undo.deleted.len(), 2);
    assert_eq!(ws.read("new/nested.txt").as_deref(), Some("created\n"));
    assert_eq!(ws.read("a.txt").as_deref(), Some("v2\n"));
    assert_eq!(ws.batches("cli-1")[0].state, "pending");
}

#[test]
fn 锚点时已删的文件_轮内重建_回退即删() {
    let ws = TempWs::new();
    ws.write("gone.txt", "base\n");
    ws.commit_all("init");
    // 锚点前删掉 gone.txt(工作区删除态)
    fs::remove_file(ws.dir.join("gone.txt")).unwrap();

    let a = ws.anchor("cli-1", "tmd-1", "锚1");
    // 轮内重建
    ws.write("gone.txt", "rebuilt\n");
    ws.seal("cli-1", "tmd-1");

    let batches = ws.batches("cli-1");
    assert_eq!(batches[0].files.len(), 1, "删除态未变不得重复入批");
    assert_eq!(batches[0].files[0].path, "gone.txt");

    restore_batch(ws.path(), &a.id, None).unwrap();
    assert!(ws.read("gone.txt").is_none(), "锚点时不存在,回退 = 删除(非复活旧基线)");
}

#[test]
fn 内容失配_自动已处理且回退被拒() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a = ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("a.txt", "v2\n");
    ws.seal("cli-1", "tmd-1");
    // 封口后用户手改
    ws.write("a.txt", "hand-edited\n");

    let batches = ws.batches("cli-1");
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

    ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("a.txt", "v2\n");
    ws.seal("cli-1", "tmd-1");
    // 用户提交批内内容
    ws.commit_all("keep batch work");

    let batches = ws.batches("cli-1");
    assert_eq!(batches[0].state, "done");
    assert_eq!(batches[0].done_reason.as_deref(), Some("已提交"));
}

#[test]
fn 单文件回退_批留待审_全处理完才翻已退() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.write("c.txt", "c1\n");
    ws.commit_all("init");

    let a = ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("a.txt", "v2\n");
    ws.write("c.txt", "c2\n");
    ws.seal("cli-1", "tmd-1");

    let out = restore_batch(ws.path(), &a.id, Some(vec!["a.txt".into()])).unwrap();
    assert_eq!(out.state, "pending", "还有一个文件未处理");
    assert_eq!(ws.read("a.txt").as_deref(), Some("v1\n"));
    assert_eq!(ws.read("c.txt").as_deref(), Some("c2\n"));

    let files = &ws.batches("cli-1")[0].files;
    assert!(files.iter().find(|f| f.path == "a.txt").unwrap().reverted);
    assert!(!files.iter().find(|f| f.path == "c.txt").unwrap().reverted);

    restore_batch(ws.path(), &a.id, Some(vec!["c.txt".into()])).unwrap();
    assert_eq!(ws.batches("cli-1")[0].state, "reverted", "全部文件处理完 → 已退");

    // 已回退批再回退被拒;反悔后回 pending
    assert!(restore_batch(ws.path(), &a.id, None).is_err());
    undo_revert(ws.path(), &a.id).unwrap();
    assert_eq!(ws.batches("cli-1")[0].state, "pending");
}

#[test]
fn 通过标记_纯标记_不阻回退() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a = ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("a.txt", "v2\n");
    ws.seal("cli-1", "tmd-1");

    assert_eq!(ws.batches("cli-1")[0].state, "pending");
    approve_batch(ws.path(), &a.id).unwrap();
    assert_eq!(ws.read("a.txt").as_deref(), Some("v2\n"), "通过不得动文件");
    assert_eq!(ws.batches("cli-1")[0].state, "approved");

    // approved 批仍可回退(标记弱于安全动作)
    let out = restore_batch(ws.path(), &a.id, None).unwrap();
    assert_eq!(out.state, "reverted");
    assert_eq!(ws.read("a.txt").as_deref(), Some("v1\n"));
    assert!(approve_batch(ws.path(), &a.id).is_err(), "已回退批不可再标记");
}

#[test]
fn open_轮不可回退() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a = ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("a.txt", "v2\n");
    // 未封口
    let err = restore_batch(ws.path(), &a.id, None).unwrap_err();
    assert!(err.to_string().contains("进行中"), "open 轮不可回退: {err}");
}

#[test]
fn prune_按批保留_锚点守卫随批清理() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a1 = ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("a.txt", "v2\n");
    ws.seal("cli-1", "tmd-1");
    restore_batch(ws.path(), &a1.id, None).unwrap(); // 产生 guard 条目

    let a2 = ws.anchor("cli-1", "tmd-1", "锚2");
    ws.write("a.txt", "v3\n");
    ws.seal("cli-1", "tmd-1");

    ws.anchor("cli-1", "tmd-1", "锚3");
    ws.write("a.txt", "v4\n");
    ws.seal("cli-1", "tmd-1");

    let dropped = prune(ws.path(), 2, 30).unwrap();
    assert!(dropped > 0);

    let batches = ws.batches("cli-1");
    assert_eq!(batches.len(), 2, "保最近 2 批");
    assert!(!batches.iter().any(|b| b.id == a1.id), "最老批随锚点清理");
    assert!(batches.iter().any(|b| b.id == a2.id));
    // 反悔依据被清理后给出明确错误
    let err = undo_revert(ws.path(), &a1.id).unwrap_err();
    assert!(!err.to_string().is_empty());
}

#[test]
fn 非_ascii_路径_往返无损() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a = ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("目录/中文文件.txt", "内容\n");
    ws.seal("cli-1", "tmd-1");

    let batches = ws.batches("cli-1");
    assert_eq!(batches[0].files[0].path, "目录/中文文件.txt");
    restore_batch(ws.path(), &a.id, None).unwrap();
    assert!(ws.read("目录/中文文件.txt").is_none());
    undo_revert(ws.path(), &a.id).unwrap();
    assert_eq!(ws.read("目录/中文文件.txt").as_deref(), Some("内容\n"));
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
    let err = anchor_turn(dir.to_str().unwrap(), "s", "s", "p", "", "", "", "git").unwrap_err();
    assert!(err.to_string().starts_with("E_NOT_A_REPO:"));
    let _ = fs::remove_dir_all(&dir);
}

