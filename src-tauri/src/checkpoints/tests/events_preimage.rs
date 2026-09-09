//! 前像自足与边界契约测试 —— 自 events.rs 拆出(文件规模铁则)。
//! 前像自足(重置后仍可回退)、非 git 工作区记账回退、路径逃逸拒绝、跨轮前像链。

use super::super::record_edit;
use super::events::{anchor_events, edit};
use super::*;

#[test]
fn events_前像自足_用户仓库_重置后仍可回退() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    anchor_events(&ws, "cli-1", "tmd-1", "改");
    ws.write("a.txt", "v2\n");
    assert!(edit(&ws, "cli-1", "tmd-1", "a.txt"));
    assert!(ws.seal("cli-1", "tmd-1"));

    // 用户仓库硬重置:blob 不再可达(等价 gc 后账本仍要自足)
    let b = &ws.batches("cli-1")[0];
    restore_batch(ws.path(), &b.id, None).unwrap();
    assert_eq!(
        ws.read("a.txt").as_deref(),
        Some("v1\n"),
        "前像来自 sidecar 自足副本"
    );
}

#[test]
fn events_非_git_工作区_记账回退照常() {
    let _g = io_lock();
    let seq = SEQ.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("tmd-ckpt-ev-nogit-{}-{seq}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let base = dir.join("store");
    fs::create_dir_all(&base).unwrap();
    set_base_for_test(base);

    // 非 git:anchor(events)不报错;基线空 → 前像无 → A 语义
    anchor_turn(dir.to_str().unwrap(), "s", "s", "p", "", "", "", "events").unwrap();
    fs::write(dir.join("new.txt"), "n1\n").unwrap();
    assert!(record_edit(dir.to_str().unwrap(), "s", "s", "new.txt", None).unwrap());
    assert!(seal_turn(dir.to_str().unwrap(), "s", "s").unwrap());

    let batches = derive_batches(dir.to_str().unwrap(), "s", "").unwrap();
    assert_eq!(batches.len(), 1);
    assert_eq!(batches[0].files[0].path, "new.txt");
    assert_eq!(batches[0].files[0].status, "A");
    // 回退 = 删除(A 文件);guard 精准快照可用 → 反悔恢复
    let id = batches[0].id.clone();
    restore_batch(dir.to_str().unwrap(), &id, None).unwrap();
    assert!(fs::read(dir.join("new.txt")).is_err());
    undo_revert(dir.to_str().unwrap(), &id).unwrap();
    assert_eq!(fs::read_to_string(dir.join("new.txt")).unwrap(), "n1\n");

    // git 归因在非 git 目录维持旧灰化语义
    let err = anchor_turn(dir.to_str().unwrap(), "s2", "s2", "p", "", "", "", "git").unwrap_err();
    assert!(err.to_string().starts_with("E_NOT_A_REPO:"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn events_路径逃逸拒绝_git_归因会话事件丢弃() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    // 路径纪律:相对父级逃逸 / 空不记账(绝对路径自 2026-09-10 起合法入账 ——
    // 审批线覆盖工作区外写入,无前像禁回退,见 tests/events_external.rs)
    anchor_events(&ws, "cli-1", "tmd-1", "p");
    assert!(!edit(&ws, "cli-1", "tmd-1", "../outside.txt"));
    assert!(!edit(&ws, "cli-1", "tmd-1", ""));

    // git 归因会话:事件流不启用
    ws.anchor("cli-2", "tmd-2", "p");
    ws.write("a.txt", "v2\n");
    assert!(!edit(&ws, "cli-2", "tmd-2", "a.txt"));
    assert!(ws.seal("cli-2", "tmd-2"), "git 归因照常推断");
    assert_eq!(ws.batches("cli-2")[0].files[0].path, "a.txt");
}

#[test]
fn events_非git_跨轮修改既有文件_前像链_回退不误删() {
    /* P0 回归:非 git 工作区 anchor 基线恒空,轮 2 修改轮 1 创建的文件时,
    前像缺失曾把 M 误记成 A —— 回退变成整文件删除,轮 1 内容丢失。
    修复:首击前像解析为空时回退取同路径最近 turn 条目的批后像。 */
    let _g = io_lock();
    let seq = SEQ.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("tmd-ckpt-chain-{}-{seq}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let base = dir.join("store");
    fs::create_dir_all(&base).unwrap();
    set_base_for_test(base);

    // 轮 1:AI 新建 a.txt(v1)并封口
    anchor_turn(dir.to_str().unwrap(), "s", "s", "一", "", "", "", "events").unwrap();
    fs::write(dir.join("a.txt"), "v1\n").unwrap();
    assert!(record_edit(dir.to_str().unwrap(), "s", "s", "a.txt", None).unwrap());
    assert!(seal_turn(dir.to_str().unwrap(), "s", "s").unwrap());

    // 轮 2:AI 修改同一文件(v2)并封口 —— 前像应链到轮 1 批后像(M),非 A
    anchor_turn(dir.to_str().unwrap(), "s", "s", "二", "", "", "", "events").unwrap();
    fs::write(dir.join("a.txt"), "v2\n").unwrap();
    assert!(record_edit(dir.to_str().unwrap(), "s", "s", "a.txt", None).unwrap());
    assert!(seal_turn(dir.to_str().unwrap(), "s", "s").unwrap());

    let batches = derive_batches(dir.to_str().unwrap(), "s", "").unwrap();
    let b2 = batches.iter().find(|b| b.prompt == "二").unwrap();
    assert_eq!(b2.files[0].status, "M", "跨轮修改既有文件是 M,不是 A");

    // 回退轮 2 = 还原到 v1,绝不删除文件
    restore_batch(dir.to_str().unwrap(), &b2.id, None).unwrap();
    assert_eq!(
        fs::read_to_string(dir.join("a.txt")).unwrap(),
        "v1\n",
        "回退还原轮前内容,不误删"
    );
    // 链继续(回退感知):轮 2 已退(后像 v2 不在磁盘)→ 轮 3 前像链跳过
    // 轮 2 取轮 1 批后像(v1),回退轮 3 仍还原 v1 而非复活被拒的 v2
    // 走一轮仍闭环
    anchor_turn(dir.to_str().unwrap(), "s", "s", "三", "", "", "", "events").unwrap();
    fs::write(dir.join("a.txt"), "v3\n").unwrap();
    assert!(record_edit(dir.to_str().unwrap(), "s", "s", "a.txt", None).unwrap());
    assert!(seal_turn(dir.to_str().unwrap(), "s", "s").unwrap());
    let b3 = derive_batches(dir.to_str().unwrap(), "s", "")
        .unwrap()
        .into_iter()
        .find(|b| b.prompt == "三")
        .unwrap();
    assert_eq!(b3.files[0].status, "M");
    restore_batch(dir.to_str().unwrap(), &b3.id, None).unwrap();
    assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "v1\n");
}
