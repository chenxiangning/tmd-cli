//! prune 保留策略测试 —— 自 tests.rs 拆出(文件规模铁则;mod 名 retention 避让导入的 prune fn)。
//! 按批保留:锚点/守卫随批清理,各会话最新锚点不丢。

use super::*;

#[test]
fn prune_按批保留_锚点守卫随批清理() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a1 = ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("a.txt", "v2\n");
    ws.seal("cli-1", "tmd-1");
    restore_batch(ws.path(), &a1.id, None).unwrap(); // 产生 guard 条目

    let a2 = ws.anchor("cli-1", "tmd-1", "锚2");
    ws.write("a.txt", "v3\n");
    ws.seal("cli-1", "tmd-1");

    ws.anchor("cli-1", "tmd-1", "锚3");
    ws.write("a.txt", "v4\n");
    ws.seal("cli-1", "tmd-1");

    let dropped = prune(ws.path(), 2, 30).unwrap();
    assert!(dropped > 0);

    let batches = ws.batches("cli-1");
    assert_eq!(batches.len(), 2, "保最近 2 批");
    assert!(!batches.iter().any(|b| b.id == a1.id), "最老批随锚点清理");
    assert!(batches.iter().any(|b| b.id == a2.id));
    // 反悔依据被清理后给出明确错误
    let err = undo_revert(ws.path(), &a1.id).unwrap_err();
    assert!(!err.to_string().is_empty());
}
