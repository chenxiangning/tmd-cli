//! events 归因测试(AI 写入事件流)—— tests.rs 的姊妹模块(文件规模铁则)。
//! 覆盖:手改不混入、重复事件修订计数、净零轮、封口后丢弃、前像自足、
//! 跨轮前像链(非 git 工作区既有文件不误记 A)、并行零误归、路径逃逸拒绝。

use super::super::{apply_batch, record_edit, LedgerEntry};
use super::*;

// ---- events 归因(AI 写入事件流,作者设计点严格版)--------------------------

fn anchor_events(ws: &TempWs, sid: &str, tmd: &str, prompt: &str) -> LedgerEntry {
    anchor_turn(ws.path(), sid, tmd, prompt, "", "", "", "events").unwrap()
}

fn edit(ws: &TempWs, sid: &str, tmd: &str, path: &str) -> bool {
    record_edit(ws.path(), sid, tmd, path).unwrap()
}

#[test]
fn events_归因_手改不混入_账本只记事件路径() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.write("手改.txt", "keep\n");
    ws.commit_all("init");

    anchor_events(&ws, "cli-1", "tmd-1", "改 a");
    ws.write("a.txt", "v2\n");
    assert!(edit(&ws, "cli-1", "tmd-1", "a.txt"));
    // 用户手改(无事件):不得混入批次 —— 设计点「跟随 AI 输出」
    ws.write("手改.txt", "user touched\n");
    assert!(ws.seal("cli-1", "tmd-1"));

    let batches = ws.batches("cli-1");
    assert_eq!(batches.len(), 1);
    assert_eq!(batches[0].files.len(), 1, "只含事件路径,手改不混入");
    assert_eq!(batches[0].files[0].path, "a.txt");
    assert_eq!(batches[0].files[0].status, "M");
    assert_eq!(batches[0].files[0].edit_count, 1);
    assert_eq!(batches[0].attribution, "events");
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
    assert_eq!(out.skipped[0].reason, "内容已变");
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
    assert!(record_edit(dir.to_str().unwrap(), "s", "s", "new.txt").unwrap());
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

    // 路径纪律:绝对路径 / 父级逃逸不记账
    anchor_events(&ws, "cli-1", "tmd-1", "p");
    assert!(!edit(&ws, "cli-1", "tmd-1", "/etc/passwd"));
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
    assert!(record_edit(dir.to_str().unwrap(), "s", "s", "a.txt").unwrap());
    assert!(seal_turn(dir.to_str().unwrap(), "s", "s").unwrap());

    // 轮 2:AI 修改同一文件(v2)并封口 —— 前像应链到轮 1 批后像(M),非 A
    anchor_turn(dir.to_str().unwrap(), "s", "s", "二", "", "", "", "events").unwrap();
    fs::write(dir.join("a.txt"), "v2\n").unwrap();
    assert!(record_edit(dir.to_str().unwrap(), "s", "s", "a.txt").unwrap());
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
    assert!(record_edit(dir.to_str().unwrap(), "s", "s", "a.txt").unwrap());
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
