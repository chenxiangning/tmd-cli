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
