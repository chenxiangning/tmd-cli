//! 会话隔离契约测试 —— 自 events.rs 拆出(文件规模铁则)。
//! 并行会话零泄露(各自事件各自账)、会话不吞外部与并行写入。

use super::events::{anchor_events, edit};
use super::*;

#[test]
fn events_并行会话零泄露_各自事件各自账() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.write("b.txt", "v1\n");
    ws.commit_all("init");

    anchor_events(&ws, "cli-1", "tmd-1", "一");
    anchor_events(&ws, "cli-2", "tmd-2", "二");
    ws.write("a.txt", "v2\n");
    ws.write("b.txt", "v2\n");
    assert!(edit(&ws, "cli-1", "tmd-1", "a.txt"));
    assert!(edit(&ws, "cli-2", "tmd-2", "b.txt"));
    assert!(ws.seal("cli-1", "tmd-1"));
    assert!(ws.seal("cli-2", "tmd-2"));

    let b1 = ws.batches("cli-1");
    let b2 = ws.batches("cli-2");
    assert_eq!(b1[0].files.len(), 1);
    assert_eq!(b1[0].files[0].path, "a.txt");
    assert_eq!(b2[0].files.len(), 1);
    assert_eq!(b2[0].files[0].path, "b.txt");
}

#[test]
fn events_会话不吞外部与并行写入_泄露回归() {
    /* 2026-09-05 账本实证:纯提问的 omp 查询会话四个批全部是并行重构会话
    与外部进程的写入(窗口推断补充吞入)。定约:events 会话批内容 = 且仅 =
    本会话 edit 行,外部/并行写入不入任何 events 批。 */
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    // 查询会话(纯提问,零事件):外部进程/用户编辑器在同 cwd 改文件
    anchor_events(&ws, "cli-q", "tmd-q", "/model");
    ws.write("external.ts", "by-outside\n");

    // 并行 omp 重构会话:写入走自己的事件链
    anchor_events(&ws, "cli-r", "tmd-r", "重构");
    ws.write("refactor.ts", "new\n");
    assert!(edit(&ws, "cli-r", "tmd-r", "refactor.ts"));

    // 查询会话封口:零事件轮零归属,外部写入不得入批
    assert!(!ws.seal("cli-q", "tmd-q"), "无 edit 行的轮不落账");
    assert!(ws.batches("cli-q").is_empty(), "查询会话的审批线必须干净");

    // 重构会话封口:只认自己的事件路径
    assert!(ws.seal("cli-r", "tmd-r"));
    let batches = ws.batches("cli-r");
    assert_eq!(batches.len(), 1);
    assert_eq!(batches[0].files.len(), 1);
    assert_eq!(batches[0].files[0].path, "refactor.ts");
}
