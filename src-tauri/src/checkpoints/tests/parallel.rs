//! 并行归属仲裁与链完整性测试 —— mtime 窗口归属 / turn 身份继承 / 幽灵窗口收口。
//! 账本与工作区基建(TempWs / io_lock)在父模块 tests。

use super::super::{anchor_turn, batch_patches, load_ledger, now_millis, record_edit, LedgerEntry};
use super::TempWs;

/// 毫秒时钟间隔:保证「写文件 → 下一个锚点」与「锚点 → 紧随写入」的 mtime
/// 严格有序(平局会让归属仲裁退化为比较谁后锚点)。25ms:容器/CI 文件系统
/// 的 mtime 粒度可粗到内核 jiffy(约 4ms),写入会被向下取整进锚点之前,
/// 归属翻转 —— ubuntu CI 实测踩中,APFS 纳秒粒度则永不复现。
fn tick() {
    std::thread::sleep(std::time::Duration::from_millis(25));
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
    tick();
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
    tick();
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
fn 并行会话_git归因不抢事件链认领的文件() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    // omp(events)先锚点 → kimi(git)并行锚点 → omp 轮内 AI 写 c.ts(edit 行认领)
    anchor_turn(
        ws.path(),
        "cli-omp",
        "tmd-omp",
        "omp 轮",
        "",
        "",
        "",
        "events",
    )
    .unwrap();
    tick();
    ws.anchor("cli-kimi", "tmd-kimi", "kimi 轮");
    tick();
    ws.write("c.ts", "by-omp\n");
    tick();
    assert!(record_edit(ws.path(), "cli-omp", "tmd-omp", "c.ts", None).unwrap());

    // kimi 封口:c.ts 的 mtime 同时落在 kimi 与 omp 的开放窗口内,按落窗规则
    // 最近锚点(kimi)会赢 —— 但 c.ts 已被 omp 的事件链认领,认领优先不抢
    assert!(
        !ws.seal("cli-kimi", "tmd-kimi"),
        "事件链认领的路径不被窗口推断抢走"
    );
    assert!(ws.batches("cli-kimi").is_empty());

    // omp 封口:c.ts 照常入自己的账
    assert!(ws.seal("cli-omp", "tmd-omp"));
    let for_omp = ws.batches("cli-omp");
    assert_eq!(for_omp.len(), 1);
    assert_eq!(for_omp[0].files[0].path, "c.ts");
}

#[test]
fn 并行会话_外会话封口后再写_认领窗口不拦新写入() {
    let ws = TempWs::new();
    ws.write("p.txt", "v1\n");
    ws.commit_all("init");

    // A 第 1 轮写 p.txt 并封口(认领)
    ws.anchor("cli-a", "tmd-a", "A 一");
    ws.write("p.txt", "v2\n");
    tick();
    assert!(ws.seal("cli-a", "tmd-a"));
    // B 锚点改 p.txt 并封口(认领)
    ws.anchor("cli-b", "tmd-b", "B 一");
    tick();
    ws.write("p.txt", "v3\n");
    tick();
    assert!(ws.seal("cli-b", "tmd-b"));
    // A 第 2 轮再改 p.txt:mtime 在 B 认领窗口之外 → 认领只护窗口内,不拦新写入
    ws.anchor("cli-a", "tmd-a", "A 二");
    tick();
    ws.write("p.txt", "v4\n");
    tick();
    assert!(ws.seal("cli-a", "tmd-a"));
    let for_a = ws.batches("cli-a");
    assert_eq!(for_a.len(), 2);
    assert_eq!(for_a[0].files.len(), 1, "A 第 2 轮只含自己的新写入");
    assert_eq!(for_a[0].files[0].path, "p.txt");
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
    tick();
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

#[test]
fn 冻结期手改_修订回补不留审计洞() {
    /* 2026-09-05 review 实证:批回退后冻结(guard 在),若修订重封整段跳过,
    冻结窗口内(回退后、下一锚点前)的手工改动会被下一锚点吞进基线,从此
    不归入任何批 —— 审计链出洞。定约:冻结批修订 = live 重算 ∪ 回补被剔出
    的封印文件,手改以新后像入修订。 */
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    ws.anchor("cli-1", "tmd-1", "改 a");
    tick();
    ws.write("a.txt", "v2\n");
    tick();
    assert!(ws.seal("cli-1", "tmd-1"));

    // 整批回退 → 批冻结;冻结窗口内手工改成 v3-hand(模拟审完又动手)
    let b = ws.batches("cli-1").into_iter().next().unwrap();
    super::super::restore_batch(ws.path(), &b.id, None).unwrap();
    assert_eq!(ws.read("a.txt").as_deref(), Some("v1\n"));
    tick();
    ws.write("a.txt", "v3-hand\n");
    tick();

    // 下一锚点隐式重封:批内容不丢,且手改以新后像入修订
    ws.anchor("cli-1", "tmd-1", "下一轮");
    let b1 = ws
        .batches("cli-1")
        .into_iter()
        .find(|x| x.id == b.id)
        .unwrap();
    assert_eq!(b1.files.len(), 1, "已退文件不得被修订剔出批");
    let patches = batch_patches(ws.path(), &b.id).unwrap();
    assert!(
        patches[0].patch.contains("+v3-hand"),
        "冻结期手改必须入修订,不得凭空消失"
    );

    // 应用回此批:批后像 = 手改后的 v3-hand(修订入批的行为铁证)
    std::fs::remove_file(std::path::Path::new(ws.path()).join("a.txt")).unwrap();
    super::super::apply_batch(ws.path(), &b.id, None).unwrap();
    assert_eq!(ws.read("a.txt").as_deref(), Some("v3-hand\n"));
}
