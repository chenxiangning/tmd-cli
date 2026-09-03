//! 并行归属仲裁与链完整性测试 —— mtime 窗口归属 / turn 身份继承 / 幽灵窗口收口。
//! 账本与工作区基建(TempWs / io_lock)在父模块 tests。

use super::super::{batch_patches, load_ledger, now_millis, LedgerEntry};
use super::TempWs;

/// 毫秒时钟间隔:保证"写文件 → 下一个锚点"的 mtime 严格有序(平局会让
/// 归属仲裁退化为比较谁后锚点)。
fn tick() {
    std::thread::sleep(std::time::Duration::from_millis(5));
}

#[test]
fn 并行会话_按写入时刻窗口归属() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    // 会话 A 锚点 → A 改 a.txt
    ws.anchor("cli-a", "tmd-a", "A 第一轮");
    ws.write("a.txt", "a2\n");
    tick();
    // 会话 B 锚点(此刻 a.txt 已是 a2,成为 B 的基线)→ B 改 b.txt
    ws.anchor("cli-b", "tmd-b", "B 第一轮");
    ws.write("b.txt", "b1\n");
    tick();
    // B 先封口:只认领 b.txt(a.txt 在 B 锚点前写入,本就不在 B 的候选里)
    assert!(ws.seal("cli-b", "tmd-b"));
    // A 后封口:a.txt 的 mtime 落在 A 窗口且 B 窗口不含它 → 归 A;
    // b.txt 的 mtime 在 B 窗口内且 B 锚点更近 → 不混入 A
    assert!(ws.seal("cli-a", "tmd-a"));

    let for_a = ws.batches("cli-a");
    assert_eq!(for_a.len(), 1);
    assert_eq!(for_a[0].files.len(), 1, "B 窗口内写入的 b.txt 不得混入 A");
    assert_eq!(for_a[0].files[0].path, "a.txt");

    let for_b = ws.batches("cli-b");
    assert_eq!(for_b.len(), 1);
    assert_eq!(for_b[0].files.len(), 1);
    assert_eq!(for_b[0].files[0].path, "b.txt");

    // A 后续轮再改 b.txt(写入时刻在 B 窗口之外)→ 归 A
    ws.anchor("cli-a", "tmd-a", "A 第二轮");
    tick();
    ws.write("b.txt", "b2-by-a\n");
    tick();
    assert!(ws.seal("cli-a", "tmd-a"));
    let for_a = ws.batches("cli-a");
    assert_eq!(for_a.len(), 2);
    assert_eq!(for_a[0].files.len(), 1);
    assert_eq!(for_a[0].files[0].path, "b.txt", "非重叠窗口可重新归属");
    assert_eq!(for_a[0].index, 2);
}

#[test]
fn 并行会话_后锚会话的写入不进先封口批() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    // A 锚点(t0)→ B 锚点(t1)→ B 写 v(t1.5)→ A 先封口
    ws.anchor("cli-a", "tmd-a", "A 第一轮");
    tick();
    ws.anchor("cli-b", "tmd-b", "B 第一轮");
    ws.write("v.txt", "by-b\n");
    tick();
    // A 先封口:v.txt 写在 B 锚点之后,归属 B(最近提示者),A 不得抢
    assert!(!ws.seal("cli-a", "tmd-a"), "A 窗口内无归属于自己的变更");
    assert!(ws.batches("cli-a").is_empty());

    // B 后封口:v.txt 归 B
    assert!(ws.seal("cli-b", "tmd-b"));
    let for_b = ws.batches("cli-b");
    assert_eq!(for_b.len(), 1);
    assert_eq!(for_b[0].files[0].path, "v.txt");
    assert!(ws.batches("cli-a").is_empty(), "A 的清单保持干净");
}

#[test]
fn turn条目身份继承锚点_封口调用方漂移不劈链() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    // CLI 身份已绑时记锚点(session_id = cli id)
    ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("a.txt", "v2\n");
    tick();
    // 封口时调用方身份漂移成 tmd id(cliSessionIds 丢失的极端情形):
    // 命中靠副键,但落账身份必须仍是锚点的 cli id
    assert!(ws.seal("tmd-1", "tmd-1"));

    let entries = load_ledger(ws.path());
    let turn = entries
        .iter()
        .find(|e| e.kind == "turn")
        .expect("turn 条目存在");
    assert_eq!(turn.session_id, "cli-1", "身份继承锚点,链不劈裂");
    assert_eq!(turn.tmd_session_id, "tmd-1");

    // 按 cli id 一查到底,turn 可见
    assert_eq!(ws.batches("cli-1").len(), 1);
}

#[test]
fn 幽灵锚点_超时未封口_代为收口() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    // 直接落一条 25h 前的锚点(app 崩溃/强退遗留,永远开放)
    let old = now_millis() - 25 * 3600 * 1000;
    let ghost = LedgerEntry {
        id: format!("s{old}-999"),
        kind: "anchor".into(),
        ts: old,
        session_id: "cli-ghost".into(),
        tmd_session_id: "tmd-ghost".into(),
        turn: 1,
        prompt: "幽灵".into(),
        ..Default::default()
    };
    super::append_ledger(ws.path(), &ghost).unwrap();

    // 窗口内的写入(此刻唯一开放窗口 = 幽灵)→ 新锚点触发代为收口,写入归幽灵账
    ws.write("a.txt", "v2\n");
    tick();
    ws.anchor("cli-a", "tmd-a", "A 第一轮");
    let entries = load_ledger(ws.path());
    let ghost_turn = entries
        .iter()
        .find(|e| e.kind == "turn" && e.id == ghost.id)
        .expect("超时锚点应被代为封口");
    assert!(ghost_turn.turn_files.iter().any(|f| f.path == "a.txt"));

    // 收口后窗口边界清晰:A 的写入归 A(锚点基线 = v2,批 diff = v2→v3)
    ws.write("a.txt", "v3\n");
    tick();
    assert!(ws.seal("cli-a", "tmd-a"));
    let for_a = ws.batches("cli-a");
    assert_eq!(for_a.len(), 1);
    assert_eq!(for_a[0].files[0].path, "a.txt");
    let patches = batch_patches(ws.path(), &for_a[0].id).unwrap();
    assert!(patches[0].patch.contains("+v3"), "A 只背自己窗口内的 v2→v3");
}
