//! apply 契约测试 —— 自 events.rs 拆出(文件规模铁则)。
//! 批后像写回(镜像回退、失配不覆盖)、prune 对象库清理、非已退批拒绝、回退后批次冻结。

use super::super::apply_batch;
use super::events::{anchor_events, edit};
use super::*;

#[test]
fn apply_批后像写回_镜像回退_失配不覆盖() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    anchor_events(&ws, "cli-1", "tmd-1", "改");
    ws.write("a.txt", "v2\n");
    assert!(edit(&ws, "cli-1", "tmd-1", "a.txt"));
    assert!(ws.seal("cli-1", "tmd-1"));
    let b = ws.batches("cli-1").into_iter().next().unwrap();

    // 回退 → 应用:内容回来,状态回待审
    restore_batch(ws.path(), &b.id, None).unwrap();
    assert_eq!(ws.read("a.txt").as_deref(), Some("v1\n"));
    let out = apply_batch(ws.path(), &b.id, None).unwrap();
    assert_eq!(out.restored, vec!["a.txt".to_string()]);
    assert_eq!(ws.read("a.txt").as_deref(), Some("v2\n"));
    assert_eq!(ws.batches("cli-1")[0].state, "pending");

    // 手改后应用:绝不静默覆盖
    restore_batch(ws.path(), &b.id, None).unwrap();
    ws.write("a.txt", "human\n");
    let out = apply_batch(ws.path(), &b.id, None).unwrap();
    assert!(out.restored.is_empty());
    assert_eq!(
        out.skipped[0].reason, "改动重叠",
        "手改区域与本批 hunk 重叠,精准重放让位"
    );
    assert_eq!(ws.read("a.txt").as_deref(), Some("human\n"));
}

#[test]
fn prune_清理对象库_保留条目引用的_blob() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    // 批 1(将被 prune 掉)
    anchor_events(&ws, "cli-1", "tmd-1", "一");
    ws.write("a.txt", "v1.1\n");
    assert!(edit(&ws, "cli-1", "tmd-1", "a.txt"));
    assert!(ws.seal("cli-1", "tmd-1"));
    // 批 2(保留)
    anchor_events(&ws, "cli-1", "tmd-1", "二");
    ws.write("a.txt", "v2\n");
    assert!(edit(&ws, "cli-1", "tmd-1", "a.txt"));
    assert!(ws.seal("cli-1", "tmd-1"));

    let b2 = ws.batches("cli-1").into_iter().next().unwrap();
    let dropped = prune(ws.path(), 1, 30).unwrap();
    assert!(dropped >= 1, "批 1 条目被清");
    assert!(ws.batches("cli-1").len() <= 1);

    // 保留批仍可回退(其引用的 blob 未被误删)
    let kept = ws.batches("cli-1").into_iter().next().unwrap();
    assert_eq!(kept.id, b2.id);
    restore_batch(ws.path(), &kept.id, None).unwrap();
    assert_eq!(ws.read("a.txt").as_deref(), Some("v1.1\n"));
}

#[test]
fn apply_非已退批拒绝_先回退再应用() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    anchor_events(&ws, "cli-1", "tmd-1", "改");
    ws.write("a.txt", "v2\n");
    assert!(edit(&ws, "cli-1", "tmd-1", "a.txt"));
    assert!(ws.seal("cli-1", "tmd-1"));
    let b = ws.batches("cli-1").into_iter().next().unwrap();

    // pending 态直调应用 IPC:后端状态闸拒绝(与 UI 露出条件一致)
    let err = apply_batch(ws.path(), &b.id, None).unwrap_err();
    assert!(err.to_string().contains("不在已退状态"), "got: {err}");

    // 回退后照常应用
    restore_batch(ws.path(), &b.id, None).unwrap();
    let out = apply_batch(ws.path(), &b.id, None).unwrap();
    assert_eq!(out.restored, vec!["a.txt".to_string()]);
    assert_eq!(ws.read("a.txt").as_deref(), Some("v2\n"));
}

#[test]
fn 回退后批次冻结_修订重封不丢已退内容() {
    /* 2026-09-05 实证:回退删掉的 A 文件在后续修订重封(下一条 prompt 的
    隐式封口 / sessionExited 兜底)里「前后像皆空」被剔出批 —— 9 文件批缩成
    1 文件,应用回此批失去依据。定约:批发生回退/应用(guard 存在)即冻结,
    反悔解除冻结(内容回到批后像,重封与原批等值不冗余)。 */
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    anchor_events(&ws, "cli-1", "tmd-1", "改");
    ws.write("new.txt", "n1\n");
    assert!(edit(&ws, "cli-1", "tmd-1", "new.txt"));
    ws.write("a.txt", "v2\n");
    assert!(edit(&ws, "cli-1", "tmd-1", "a.txt"));
    assert!(ws.seal("cli-1", "tmd-1"));

    // 整批回退:new.txt(A 文件)删除,a.txt 还原 v1
    let b = ws.batches("cli-1").into_iter().next().unwrap();
    let out = restore_batch(ws.path(), &b.id, None).unwrap();
    assert_eq!(out.deleted, vec!["new.txt".to_string()]);
    assert!(ws.read("new.txt").is_none());

    // 下一条 prompt(隐式重封上一轮):已回退批冻结,文件集不被 live 重算
    anchor_events(&ws, "cli-1", "tmd-1", "下一轮");
    let b1 = ws
        .batches("cli-1")
        .into_iter()
        .find(|x| x.id == b.id)
        .unwrap();
    assert_eq!(b1.files.len(), 2, "回退删除的文件不得被修订重封剔出批");

    // 反悔:guard 清除(解冻),内容写回,批回待审
    undo_revert(ws.path(), &b.id).unwrap();
    assert_eq!(ws.read("new.txt").as_deref(), Some("n1\n"));

    // 再次回退后应用:批后像完整写回(冻结不碍恢复动作)
    restore_batch(ws.path(), &b.id, None).unwrap();
    let out = apply_batch(ws.path(), &b.id, None).unwrap();
    assert_eq!(out.restored.len(), 2);
    assert_eq!(ws.read("new.txt").as_deref(), Some("n1\n"));
    assert_eq!(ws.read("a.txt").as_deref(), Some("v2\n"));
    // 应用 guard 同样冻结:批内容不丢
    let b1 = ws
        .batches("cli-1")
        .into_iter()
        .find(|x| x.id == b.id)
        .unwrap();
    assert_eq!(b1.files.len(), 2);
}
