//! 会话身份契约测试 —— 自 tests.rs 拆出(文件规模铁则)。
//! 会话严格隔离(新会话从零)与 CLI 身份回填(tmd 名下历史并入绑定链)。

use super::*;

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
    assert_eq!(
        batches.len(),
        1,
        "回填后按 CLI id 一查到底(第 2 轮纯阅读不出现)"
    );
    assert_eq!(batches[0].id, a1.id);
    assert_eq!(batches[0].index, 1);

    // 回退经 CLI id 链照常工作:还原到第 1 轮锚点之前的内容 v1
    let out = restore_batch(ws.path(), &a1.id, None).unwrap();
    assert_eq!(out.restored, vec!["a.txt".to_string()]);
    assert_eq!(ws.read("a.txt").as_deref(), Some("v1\n"));
}

#[test]
fn cli身份回填_换绑后旧身份链摘除副键原地保留() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    // 旧对话:composer 轮次整链记在 (cli-a, tmd-x) 名下并封口
    let old_anchor = ws.anchor("cli-a", "tmd-x", "旧对话第一轮");
    ws.write("a.txt", "v2\n");
    assert!(ws.seal("cli-a", "tmd-x"));

    // CLI 同终端换磁盘会话(omp /new),回声重验重绑 cli-b:新对话首锚触发回填
    let new_anchor = ws.anchor("cli-b", "tmd-x", "新对话第一轮");
    ws.write("a.txt", "v3\n");
    assert!(ws.seal("cli-b", "tmd-x"));

    // 旧链保持自身身份、tmd 副键已摘:新链查询不再误命中旧对话
    assert_eq!(
        derive_batches(ws.path(), "cli-b", "tmd-x").unwrap().len(),
        1
    );
    let ledger = load_ledger(ws.path());
    let old_entries: Vec<_> = ledger.iter().filter(|e| e.session_id == "cli-a").collect();
    assert!(
        old_entries.len() >= 2,
        "旧链条目原地保留(锚点+封口),不并入新身份"
    );
    assert!(
        old_entries.iter().all(|e| e.tmd_session_id.is_empty()),
        "旧链 tmd 副键摘除,新链查询经副键不再命中"
    );
    assert_eq!(old_entries[0].id, old_anchor.id, "旧链内容不变");

    // 新链轮次从 1 起算(摘链后不再继承旧链轮号)
    assert_eq!(new_anchor.turn, 1, "换绑后新对话轮次独立起算");

    // resume 旧对话(按主键查询)仍能找回自己的账
    assert_eq!(derive_batches(ws.path(), "cli-a", "").unwrap().len(), 1);
}
