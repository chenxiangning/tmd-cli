//! 回退/应用/通过标记的集成测试 —— tests.rs 的拆分件(文件规模铁则)。
//! 夹具与并行隔离(io_lock/TempWs)随父模块,`use super::*` 取用。

use super::super::{apply_batch, approve_batch, restore_batch, undo_revert};
use super::*;

#[test]
fn 轮内新建_回退即删除_反悔恢复() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a = ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("new/nested.txt", "created\n");
    ws.write("a.txt", "v2\n");
    ws.seal("cli-1", "tmd-1");

    let batches = ws.batches("cli-1");
    assert_eq!(batches[0].files.len(), 2);

    let out = restore_batch(ws.path(), &a.id, None).unwrap();
    assert_eq!(
        out.deleted,
        vec!["new/nested.txt".to_string()],
        "轮内新建,回退 = 删除"
    );
    assert_eq!(out.restored, vec!["a.txt".to_string()]);
    assert_eq!(out.state, "reverted");
    assert!(out.guard_id.is_some());
    assert!(ws.read("new/nested.txt").is_none());
    assert_eq!(ws.read("a.txt").as_deref(), Some("v1\n"));

    // 反悔 → 守卫条目写回回退前状态
    let undo = undo_revert(ws.path(), &a.id).unwrap();
    assert_eq!(undo.restored.len() + undo.deleted.len(), 2);
    assert_eq!(ws.read("new/nested.txt").as_deref(), Some("created\n"));
    assert_eq!(ws.read("a.txt").as_deref(), Some("v2\n"));
    assert_eq!(ws.batches("cli-1")[0].state, "pending");
}

#[test]
fn 锚点时已删的文件_轮内重建_回退即删() {
    let ws = TempWs::new();
    ws.write("gone.txt", "base\n");
    ws.commit_all("init");
    // 锚点前删掉 gone.txt(工作区删除态)
    fs::remove_file(ws.dir.join("gone.txt")).unwrap();

    let a = ws.anchor("cli-1", "tmd-1", "锚1");
    // 轮内重建
    ws.write("gone.txt", "rebuilt\n");
    ws.seal("cli-1", "tmd-1");

    let batches = ws.batches("cli-1");
    assert_eq!(batches[0].files.len(), 1, "删除态未变不得重复入批");
    assert_eq!(batches[0].files[0].path, "gone.txt");

    restore_batch(ws.path(), &a.id, None).unwrap();
    assert!(
        ws.read("gone.txt").is_none(),
        "锚点时不存在,回退 = 删除(非复活旧基线)"
    );
}

#[test]
fn 内容失配_自动已处理且回退被拒() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a = ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("a.txt", "v2\n");
    ws.seal("cli-1", "tmd-1");
    // 封口后用户手改
    ws.write("a.txt", "hand-edited\n");

    let batches = ws.batches("cli-1");
    assert_eq!(batches[0].state, "done");
    assert_eq!(batches[0].done_reason.as_deref(), Some("内容已变"));
    assert!(batches[0].files[0].stale);

    let err = restore_batch(ws.path(), &a.id, None).unwrap_err();
    assert!(
        err.to_string().starts_with("E_EMPTY:"),
        "失配文件不可回退: {err}"
    );
}

#[test]
fn 用户提交_自动已处理_理由已提交() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("a.txt", "v2\n");
    ws.seal("cli-1", "tmd-1");
    // 用户提交批内内容
    ws.commit_all("keep batch work");

    let batches = ws.batches("cli-1");
    assert_eq!(batches[0].state, "done");
    assert_eq!(batches[0].done_reason.as_deref(), Some("已提交"));
}

#[test]
fn 单文件回退_批留待审_全处理完才翻已退() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.write("c.txt", "c1\n");
    ws.commit_all("init");

    let a = ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("a.txt", "v2\n");
    ws.write("c.txt", "c2\n");
    ws.seal("cli-1", "tmd-1");

    let out = restore_batch(ws.path(), &a.id, Some(vec!["a.txt".into()])).unwrap();
    assert_eq!(out.state, "pending", "还有一个文件未处理");
    assert_eq!(ws.read("a.txt").as_deref(), Some("v1\n"));
    assert_eq!(ws.read("c.txt").as_deref(), Some("c2\n"));

    let files = &ws.batches("cli-1")[0].files;
    assert!(files.iter().find(|f| f.path == "a.txt").unwrap().reverted);
    assert!(!files.iter().find(|f| f.path == "c.txt").unwrap().reverted);

    restore_batch(ws.path(), &a.id, Some(vec!["c.txt".into()])).unwrap();
    assert_eq!(
        ws.batches("cli-1")[0].state,
        "reverted",
        "全部文件处理完 → 已退"
    );

    // 已回退批再回退被拒;反悔后回 pending
    assert!(restore_batch(ws.path(), &a.id, None).is_err());
    undo_revert(ws.path(), &a.id).unwrap();
    assert_eq!(ws.batches("cli-1")[0].state, "pending");
}

#[test]
fn 通过标记_纯标记_不阻回退() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a = ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("a.txt", "v2\n");
    ws.seal("cli-1", "tmd-1");

    assert_eq!(ws.batches("cli-1")[0].state, "pending");
    approve_batch(ws.path(), &a.id).unwrap();
    assert_eq!(ws.read("a.txt").as_deref(), Some("v2\n"), "通过不得动文件");
    assert_eq!(ws.batches("cli-1")[0].state, "approved");

    // approved 批仍可回退(标记弱于安全动作)
    let out = restore_batch(ws.path(), &a.id, None).unwrap();
    assert_eq!(out.state, "reverted");
    assert_eq!(ws.read("a.txt").as_deref(), Some("v1\n"));
    assert!(
        approve_batch(ws.path(), &a.id).is_err(),
        "已回退批不可再标记"
    );
}

#[test]
fn open_轮不可回退() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a = ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("a.txt", "v2\n");
    // 未封口
    let err = restore_batch(ws.path(), &a.id, None).unwrap_err();
    assert!(err.to_string().contains("进行中"), "open 轮不可回退: {err}");
}

// ---- 共改文件精准手术(patch.rs 集成)------------------------------------

/// 12 行文件,行内容 = l1..l12。
fn lines12() -> String {
    (1..=12).map(|i| format!("l{i}\n")).collect()
}

#[test]
fn 共改文件_按diff精准擦除_他人写入保留() {
    let ws = TempWs::new();
    ws.write("a.txt", lines12().as_str());
    ws.commit_all("init");

    // 本批(会话 A):改 l2
    let a = ws.anchor("cli-a", "tmd-a", "A");
    ws.write("a.txt", lines12().replace("l2\n", "l2-A\n").as_str());
    ws.seal("cli-a", "tmd-a");

    // 他人(并行会话 B):在批后改 l8
    ws.write(
        "a.txt",
        lines12()
            .replace("l2\n", "l2-A\n")
            .replace("l8\n", "l8-B\n")
            .as_str(),
    );

    // 回退:l2 擦回原文,l8-B 保留 —— 不再连坐
    let out = restore_batch(ws.path(), &a.id, None).unwrap();
    assert_eq!(out.restored, vec!["a.txt".to_string()]);
    assert_eq!(
        ws.read("a.txt").as_deref(),
        Some(lines12().replace("l8\n", "l8-B\n").as_str()),
        "本批改动精准擦除,他人写入保留"
    );
    assert_eq!(out.state, "reverted");
}

#[test]
fn 共改文件_同区域重叠_跳过不覆盖() {
    let ws = TempWs::new();
    ws.write("a.txt", lines12().as_str());
    ws.commit_all("init");

    let a = ws.anchor("cli-a", "tmd-a", "A");
    ws.write("a.txt", lines12().replace("l2\n", "l2-A\n").as_str());
    ws.seal("cli-a", "tmd-a");

    // 他人改的正是本批那一行:擦除 hunk 上下文失配
    ws.write("a.txt", lines12().replace("l2\n", "l2-B\n").as_str());

    let err = restore_batch(ws.path(), &a.id, None).unwrap_err();
    assert!(err.to_string().contains("E_EMPTY"), "无路可走即拒绝: {err}");
    assert_eq!(
        ws.read("a.txt").as_deref(),
        Some(lines12().replace("l2\n", "l2-B\n").as_str()),
        "重叠冲突绝不静默覆盖"
    );
}

#[test]
fn 应用_他人写入在场_精准重放本批改动() {
    let ws = TempWs::new();
    ws.write("a.txt", lines12().as_str());
    ws.commit_all("init");

    let a = ws.anchor("cli-a", "tmd-a", "A");
    ws.write("a.txt", lines12().replace("l2\n", "l2-A\n").as_str());
    ws.seal("cli-a", "tmd-a");
    restore_batch(ws.path(), &a.id, None).unwrap();

    // 回退后他人又改了 l8:应用时 l2-A 重放回来,l8-B 保留
    ws.write("a.txt", lines12().replace("l8\n", "l8-B\n").as_str());
    let out = apply_batch(ws.path(), &a.id, None).unwrap();
    assert_eq!(out.restored, vec!["a.txt".to_string()]);
    assert_eq!(
        ws.read("a.txt").as_deref(),
        Some(
            lines12()
                .replace("l2\n", "l2-A\n")
                .replace("l8\n", "l8-B\n")
                .as_str()
        ),
    );
}
