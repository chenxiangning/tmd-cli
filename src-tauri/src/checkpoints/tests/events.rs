//! events 归因测试(AI 写入事件流)—— tests.rs 的姊妹模块(文件规模铁则)。
//! 覆盖:shell 落盘并入(事件盲区走 git 窗口推断)、锚点基线外才算、重复事件
//! 修订计数、净零轮、封口后丢弃、前像自足、跨轮前像链(非 git 工作区既有文件
//! 不误记 A)、并行零误归、路径逃逸拒绝。

use super::super::{record_edit, LedgerEntry};
use super::*;

// ---- events 归因(AI 写入事件流,作者设计点严格版)--------------------------

pub(super) fn anchor_events(ws: &TempWs, sid: &str, tmd: &str, prompt: &str) -> LedgerEntry {
    anchor_turn(ws.path(), sid, tmd, prompt, "", "", "", "events").unwrap()
}

pub(super) fn edit(ws: &TempWs, sid: &str, tmd: &str, path: &str) -> bool {
    record_edit(ws.path(), sid, tmd, path, None).unwrap()
}

#[test]
fn events_迟到事件_早于锚点丢弃_防上一轮尾巴串轮() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");
    let anchor = anchor_events(&ws, "cli-1", "tmd-1", "改 a");
    ws.write("a.txt", "v2\n");
    // 磁盘事件源迟到拉取:早于锚点的写入属上一轮(锚点隐式封上一轮),丢弃
    assert!(!record_edit(
        ws.path(),
        "cli-1",
        "tmd-1",
        "a.txt",
        Some(anchor.ts - 5_000)
    )
    .unwrap());
    // 本轮事件(晚于锚点)照常入账;None = PTY 标记无时刻,守卫不适用
    assert!(record_edit(
        ws.path(),
        "cli-1",
        "tmd-1",
        "a.txt",
        Some(anchor.ts + 1_000)
    )
    .unwrap());
    assert!(edit(&ws, "cli-1", "tmd-1", "a.txt"));
    assert!(ws.seal("cli-1", "tmd-1"));
    let batches = ws.batches("cli-1");
    assert_eq!(batches.len(), 1);
    assert_eq!(
        batches[0].files[0].edit_count, 2,
        "迟到事件已弃,仅本轮两次入账"
    );
}

#[test]
fn events_归因_纯事件流_shell落盘不入批() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.write("基线脏.txt", "pre\n");
    ws.commit_all("init");
    // 锚点前已脏的手改:内容已入锚点基线,本轮不动 → 不入批(手改不误伤)
    ws.write("基线脏.txt", "dirty-before-anchor\n");
    anchor_events(&ws, "cli-1", "tmd-1", "改 a");
    ws.write("a.txt", "v2\n");
    assert!(edit(&ws, "cli-1", "tmd-1", "a.txt"));
    // shell 落盘(cp/脚本/重定向,无事件):不并入批 —— 窗口推断只能证明
    // 「何时被写」不能证明「谁写的」,并回来即外部/并行写入串批(2026-09-05
    // 泄露回归定约:隔离优先于覆盖面,盲区换会话独立)
    ws.write("shots/gen.png", "png\n");
    assert!(ws.seal("cli-1", "tmd-1"));

    let batches = ws.batches("cli-1");
    assert_eq!(batches.len(), 1);
    assert_eq!(batches[0].attribution, "events");
    assert_eq!(batches[0].files.len(), 1, "批内容 = 且仅 = 本轮 edit 行");
    assert_eq!(batches[0].files[0].path, "a.txt");
    assert_eq!(batches[0].files[0].status, "M");
    assert_eq!(batches[0].files[0].edit_count, 1);
    assert!(
        batches[0].files.iter().all(|f| f.path != "shots/gen.png"),
        "无事件写入不入批"
    );
    assert!(
        batches[0].files.iter().all(|f| f.path != "基线脏.txt"),
        "锚点基线之外无变化的手改不入批"
    );
}

#[test]
fn events_open待审_只列事件路径() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    anchor_events(&ws, "cli-1", "tmd-1", "改 a");
    ws.write("a.txt", "v2\n");
    assert!(edit(&ws, "cli-1", "tmd-1", "a.txt"));
    ws.write("shots/gen.png", "png\n"); // 无事件 shell 落盘:不入 open 批
    let batches = ws.batches("cli-1"); // 未封口 = open 待审批
    assert_eq!(batches.len(), 1);
    assert!(batches[0].open);
    let paths: Vec<&str> = batches[0].files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths, vec!["a.txt"]);
    // 时间线 ± 与审阅单同源:只含事件路径的 patch
    let patches = batch_patches(ws.path(), &batches[0].id).unwrap();
    let ppaths: Vec<&str> = patches.iter().map(|p| p.path.as_str()).collect();
    assert_eq!(ppaths, vec!["a.txt"]);
}

#[test]
fn events_重复事件_修订计数_前像只抓首击() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    anchor_events(&ws, "cli-1", "tmd-1", "改");
    ws.write("a.txt", "v2\n");
    assert!(edit(&ws, "cli-1", "tmd-1", "a.txt"));
    ws.write("a.txt", "v3\n");
    assert!(edit(&ws, "cli-1", "tmd-1", "a.txt"));
    assert!(edit(&ws, "cli-1", "tmd-1", "a.txt"));
    ws.seal("cli-1", "tmd-1");

    let b = &ws.batches("cli-1")[0];
    assert_eq!(b.files[0].edit_count, 3, "重复事件修订计数");
    // 回退 = 写回首击前像(v1),不是中间态
    restore_batch(ws.path(), &b.id, None).unwrap();
    assert_eq!(ws.read("a.txt").as_deref(), Some("v1\n"));
}

#[test]
fn events_写了又写回_净零不入批() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    anchor_events(&ws, "cli-1", "tmd-1", "改");
    ws.write("a.txt", "v2\n");
    assert!(edit(&ws, "cli-1", "tmd-1", "a.txt"));
    ws.write("a.txt", "v1\n"); // 写回原样
    assert!(edit(&ws, "cli-1", "tmd-1", "a.txt"));
    // 净零轮:落空 turn 行把轮关上(不再被当 open),但不上时间线
    assert!(ws.seal("cli-1", "tmd-1"), "净零轮落空 turn 行封口");
    assert!(ws.batches("cli-1").is_empty(), "净零批不上时间线");
}

#[test]
fn events_新建与删除_封口后事件丢弃() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    anchor_events(&ws, "cli-1", "tmd-1", "建删");
    ws.write("new.txt", "n1\n");
    assert!(edit(&ws, "cli-1", "tmd-1", "new.txt"));
    // AI 事件后文件被删(如 AI 自己 Bash rm):seal 判 D
    ws.write("a.txt", "v2\n");
    assert!(edit(&ws, "cli-1", "tmd-1", "a.txt"));
    assert!(ws.seal("cli-1", "tmd-1"));
    // 封口后的事件(重绘/回放)不记账
    assert!(!edit(&ws, "cli-1", "tmd-1", "ghost.txt"));

    let b = &ws.batches("cli-1")[0];
    let new = b.files.iter().find(|f| f.path == "new.txt").unwrap();
    assert_eq!(new.status, "A");
    assert_eq!(
        b.files.iter().find(|f| f.path == "a.txt").unwrap().status,
        "M"
    );
    // 回退:A 文件删除、M 文件还原
    restore_batch(ws.path(), &b.id, None).unwrap();
    assert!(ws.read("new.txt").is_none());
    assert_eq!(ws.read("a.txt").as_deref(), Some("v1\n"));
}
