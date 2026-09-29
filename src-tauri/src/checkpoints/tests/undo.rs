//! 反悔(undo_revert)专项 —— tests.rs 的拆分件(文件规模铁则)。
//! 夹具与并行隔离(io_lock/TempWs)随父模块,`use super::*` 取用。

use super::super::{restore_batch, undo_revert};
use super::*;

/// 守卫快照不可用(符号链接等 skip=Some)的路径,反悔不得删盘上文件。
/// 旧实现把「守卫没内容」当「守卫时刻不存在」→ fs::remove_file 整删用户
/// 既有内容 = 数据丢失(2026-09-28 三轮评审 CKPT-R1,F-CKPT-001 同族):
/// 必须断言盘上文件,不止 state(F-CKPT-001 教训)。
#[test]
#[cfg(unix)]
fn 反悔_守卫快照不可用的路径_保留盘上文件() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a = ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("a.txt", "v1\nextra\n");
    ws.seal("cli-1", "tmd-1");

    // 回退前把 a.txt 换成可读符号链接:live 读到批后像(untouched 直写批前像),
    // 但守卫经 symlink_metadata 记 skip=「符号链接」,无内容可反悔
    fs::remove_file(ws.dir.join("a.txt")).unwrap();
    ws.write("link-target.txt", "v1\nextra\n");
    std::os::unix::fs::symlink(ws.dir.join("link-target.txt"), ws.dir.join("a.txt")).unwrap();

    let out = restore_batch(ws.path(), &a.id, None).unwrap();
    assert_eq!(out.state, "reverted", "符号链接 live 直写批前像,回退成立");
    assert_eq!(out.restored, vec!["a.txt".to_string()]);

    // 反悔:守卫快照不可用 → 保守跳过并维持已退态,绝不删盘上文件
    let undo = undo_revert(ws.path(), &a.id).unwrap();
    assert!(
        undo.deleted.is_empty(),
        "守卫无快照的路径不得进 deleted: {:?}",
        undo.deleted
    );
    assert_eq!(
        ws.read("a.txt").as_deref(),
        Some("v1\n"),
        "盘上文件必须还在"
    );
    assert_eq!(ws.batches("cli-1")[0].state, "reverted");
}
