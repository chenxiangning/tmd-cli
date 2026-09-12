//! 工作区外文件入账测试(2026-09-10 审批线覆盖 cwd 之外的 AI 写入)。
//! 覆盖:路径归一(绝对词法归一 / ~ 展开 / 相对逃逸与空拒绝)、封口无前像
//! 禁回退编码、restore 显式跳过(同批工作区内文件照常回退)、跨轮前像链
//! 恢复回退能力、open 批外部文件 M 语义、live 分类不误判 committed(批不
//! 提前推 done)。
//! 硬约束回归:工作区内相对路径原文存储、纪律逐字旧则(第一条用例)。

use super::super::{canonicalize_event_path, record_edit, restore_batch};
use super::events::{anchor_events, edit};
use super::*;

/// 工作区外临时文件(cwd 之外,不参与 git;path 直传绝对形态)。
struct ExtFile {
    dir: std::path::PathBuf,
}

impl ExtFile {
    fn new(tag: &str) -> Self {
        let seq = SEQ.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("tmd-ckpt-ext-{}-{seq}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Self { dir }
    }

    fn path(&self) -> String {
        self.dir.join("plugin.json").to_string_lossy().into_owned()
    }

    fn write(&self, content: &str) {
        fs::write(self.path(), content).unwrap();
    }

    fn read(&self) -> Option<String> {
        fs::read_to_string(self.path()).ok()
    }
}

impl Drop for ExtFile {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn 外部路径归一_绝对与波浪展开_相对纪律不变() {
    // 工作区内相对路径:原文存储(含 // 不重写),逃逸/空逐字旧则
    assert_eq!(
        canonicalize_event_path("src/a.ts"),
        Some("src/a.ts".to_string())
    );
    assert_eq!(canonicalize_event_path("a//b"), Some("a//b".to_string()));
    assert_eq!(canonicalize_event_path("../x"), None);
    assert_eq!(canonicalize_event_path("a/../b"), None);
    assert_eq!(canonicalize_event_path(""), None);
    // 工作区外绝对路径:词法归一(. 消除、.. 弹一层、根处越界截断)
    assert_eq!(
        canonicalize_event_path("/a/./b/../c"),
        Some("/a/c".to_string())
    );
    assert_eq!(
        canonicalize_event_path("/../etc/passwd"),
        Some("/etc/passwd".to_string())
    );
    assert_eq!(canonicalize_event_path("/"), None);
    // ~ 展开:~/ → home(必在工作区外);裸 ~ 与 ~other 形式拒
    let home = dirs::home_dir().unwrap();
    let want = format!("{}/x/y.json", home.to_string_lossy().trim_end_matches('/'));
    assert_eq!(canonicalize_event_path("~/x/y.json"), Some(want));
    assert_eq!(canonicalize_event_path("~"), None);
    assert_eq!(canonicalize_event_path("~root/x"), None);
    // Windows 盘符形态两态都拒(Rust 单闸终审,不依赖前端已拒)
    assert_eq!(canonicalize_event_path("C:\\Users\\x\\a.txt"), None);
    assert_eq!(canonicalize_event_path("C:/Users/x/a.txt"), None);
}

#[test]
fn 外部文件_首轮无前像_禁回退_同批工作区内照常() {
    let ws = TempWs::new();
    ws.write("in.txt", "v1\n");
    ws.commit_all("init");
    let ext = ExtFile::new("t1");
    // 既有外部文件被覆盖:首轮无前像时与「批内新建」无法区分,必须保守
    ext.write("{\"old\":true}\n");

    let anchor = anchor_events(&ws, "cli-1", "tmd-1", "改两处");
    ws.write("in.txt", "v2\n");
    assert!(edit(&ws, "cli-1", "tmd-1", "in.txt"));
    let ext_path = ext.path();
    assert!(record_edit(ws.path(), "cli-1", "tmd-1", &ext_path, None).unwrap());
    assert!(ws.seal("cli-1", "tmd-1"));

    let batches = ws.batches("cli-1");
    assert_eq!(batches.len(), 1);
    // live 分类:外部同容 = same(误判 committed 会把批提前推 done)
    assert_eq!(batches[0].state, "pending");
    let ef = batches[0]
        .files
        .iter()
        .find(|f| f.path == ext_path)
        .expect("外部文件入批");
    assert!(ef.no_baseline, "外部首轮无前像须标记禁回退");
    assert_eq!(ef.status, "M"); // 不记 A:回退删文件语义不可落到既有文件上
    assert_eq!(ef.live, "same");
    let inf = batches[0]
        .files
        .iter()
        .find(|f| f.path == "in.txt")
        .unwrap();
    assert!(!inf.no_baseline);
    assert_eq!(inf.status, "M");

    // 回退整批:外部显式跳过且磁盘原样(不误删既有文件),工作区内正常回退
    let out = restore_batch(ws.path(), &anchor.id, None).unwrap();
    assert_eq!(out.skipped.len(), 1);
    assert_eq!(out.skipped[0].path, ext_path);
    assert!(out.skipped[0].reason.contains("禁回退"));
    assert_eq!(ext.read().unwrap(), "{\"old\":true}\n");
    assert_eq!(ws.read("in.txt").unwrap(), "v1\n");
}

#[test]
fn 外部文件_跨轮前像链_次轮回退恢复() {
    let ws = TempWs::new();
    ws.write("x", "0\n");
    ws.commit_all("init");
    let ext = ExtFile::new("t2");
    ext.write("v1\n"); // 会话前既有内容
    let ext_path = ext.path();

    // 首轮:AI 覆盖为 v2 —— 无前像,禁回退
    anchor_events(&ws, "cli-1", "tmd-1", "首轮");
    ext.write("v2\n");
    assert!(record_edit(ws.path(), "cli-1", "tmd-1", &ext_path, None).unwrap());
    assert!(ws.seal("cli-1", "tmd-1"));
    let b1 = ws.batches("cli-1");
    assert!(
        b1[0]
            .files
            .iter()
            .find(|f| f.path == ext_path)
            .unwrap()
            .no_baseline
    );

    // 次轮:前像 = 首轮批后像(v2,跨轮链)→ 可正常回退
    let anchor2 = anchor_events(&ws, "cli-1", "tmd-1", "次轮");
    ext.write("v3\n");
    assert!(record_edit(ws.path(), "cli-1", "tmd-1", &ext_path, None).unwrap());
    assert!(ws.seal("cli-1", "tmd-1"));
    let b2 = ws.batches("cli-1");
    let f2 = b2
        .iter()
        .find(|b| b.id == anchor2.id)
        .unwrap()
        .files
        .iter()
        .find(|f| f.path == ext_path)
        .unwrap();
    assert!(!f2.no_baseline, "次轮起跨轮链供应前像,回退能力恢复");
    assert_eq!(f2.status, "M");

    let out = restore_batch(ws.path(), &anchor2.id, None).unwrap();
    assert!(out.skipped.is_empty());
    assert_eq!(out.restored, vec![ext_path.clone()]);
    assert_eq!(ext.read().unwrap(), "v2\n");
}

#[test]
fn 外部文件_open批_修改语义_工作区内新建仍新增() {
    let ws = TempWs::new();
    ws.commit_all("init");
    let ext = ExtFile::new("t3");
    ext.write("e\n");
    let ext_path = ext.path();

    anchor_events(&ws, "cli-1", "tmd-1", "进行中轮");
    assert!(record_edit(ws.path(), "cli-1", "tmd-1", &ext_path, None).unwrap());
    ws.write("new.txt", "n\n");
    assert!(edit(&ws, "cli-1", "tmd-1", "new.txt"));

    let batches = ws.batches("cli-1");
    assert_eq!(batches.len(), 1);
    assert!(batches[0].open);
    let ef = batches[0]
        .files
        .iter()
        .find(|f| f.path == ext_path)
        .unwrap();
    assert_eq!(ef.status, "M", "外部无前像不记 A(对齐封口禁回退编码)");
    assert!(ef.no_baseline);
    let nf = batches[0]
        .files
        .iter()
        .find(|f| f.path == "new.txt")
        .unwrap();
    assert_eq!(nf.status, "A"); // 工作区内语义零漂移
    assert!(!nf.no_baseline);
}
