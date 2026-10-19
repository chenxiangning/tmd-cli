//! 恢复 dry-run 预览测试 —— plan_restore 交集/空集/skip 理由 +
//! restore_preview 覆盖药丸/binary/子集。夹具与并行隔离(io_lock/TempWs)
//! 随父模块,`use super::*` 取用。

use super::super::{plan_restore, restore_batch, restore_preview};
use super::*;

#[test]
fn plan_restore_子集_只算交集_不消费计划() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.write("b.txt", "v1\n");
    ws.commit_all("init");

    let a = ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("a.txt", "v2\n");
    ws.write("b.txt", "v2\n");
    ws.seal("cli-1", "tmd-1");

    let plan = plan_restore(ws.path(), &a.id, Some(vec!["a.txt".into()])).unwrap();
    assert_eq!(plan.items.len(), 1);
    assert_eq!(plan.items[0].path, "a.txt");
    assert!(!plan.items[0].overwrite, "live 未偏离,非覆盖行");

    // 预览/计划解析无副作用:紧接真实回退仍走完整守卫链
    let out = restore_batch(ws.path(), &a.id, None).unwrap();
    assert!(out.guard_id.is_some());
    assert_eq!(out.restored.len(), 2);
}

#[test]
fn plan_restore_路径不在批次内_拒绝() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a = ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("a.txt", "v2\n");
    ws.seal("cli-1", "tmd-1");

    let err = plan_restore(ws.path(), &a.id, Some(vec!["nope.txt".into()])).unwrap_err();
    assert!(err.to_string().contains("路径不在批次内"), "{err}");
}

#[test]
fn plan_restore_全部跳过_空计划_e_empty_plan() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a = ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("a.txt", "v2\n");
    ws.seal("cli-1", "tmd-1");

    // 他人改动与本批同区域重叠 → 手术不可行 → 全部 skip → plan 空
    ws.write("a.txt", "totally different\n");
    let err = plan_restore(ws.path(), &a.id, None).unwrap_err();
    assert!(err.to_string().contains("E_EMPTY_PLAN"), "{err}");

    let err = restore_preview(ws.path(), &a.id, None).unwrap_err();
    assert!(err.to_string().contains("E_EMPTY_PLAN"), "{err}");
}

#[test]
fn preview_已回退路径_跳过带理由() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.write("b.txt", "v1\n");
    ws.commit_all("init");

    let a = ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("a.txt", "v2\n");
    ws.write("b.txt", "v2\n");
    ws.seal("cli-1", "tmd-1");

    // 先单文件回退 a,再预览整批:a 走「已回退」skip,b 照常出行
    restore_batch(ws.path(), &a.id, Some(vec!["a.txt".into()])).unwrap();
    let pv = restore_preview(ws.path(), &a.id, None).unwrap();
    assert_eq!(pv.rows.len(), 1);
    assert_eq!(pv.rows[0].path, "b.txt");
    assert_eq!(pv.skipped.len(), 1);
    assert_eq!(pv.skipped[0].path, "a.txt");
    assert_eq!(pv.skipped[0].reason, "已回退");

    // dry-run 不动盘
    assert_eq!(ws.read("a.txt").as_deref(), Some("v1\n"));
}

#[test]
fn preview_精准擦除行_标记覆盖本地() {
    let ws = TempWs::new();
    let base: String = (1..=12).map(|i| format!("l{i}\n")).collect();
    ws.write("a.txt", base.as_str());
    ws.commit_all("init");

    // 本批改 l2
    let a = ws.anchor("cli-1", "tmd-1", "锚1");
    ws.write("a.txt", base.replace("l2\n", "l2-A\n").as_str());
    ws.seal("cli-1", "tmd-1");

    // 他人批后改 l8(不同区域,手术可擦)
    ws.write(
        "a.txt",
        base.replace("l2\n", "l2-A\n")
            .replace("l8\n", "l8-B\n")
            .as_str(),
    );

    let pv = restore_preview(ws.path(), &a.id, None).unwrap();
    assert_eq!(pv.rows.len(), 1);
    assert!(pv.rows[0].overwrites, "精准擦除成功行 = 真实覆盖");
    assert_eq!(pv.rows[0].kind, "M");
    assert!(pv.rows[0].additions > 0 && pv.rows[0].deletions > 0);

    // 预览不改写工作区:他人写入仍在盘上
    assert!(ws.read("a.txt").unwrap().contains("l8-B\n"));
}

#[test]
fn preview_binary_按0行计_删除语义() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a = ws.anchor("cli-1", "tmd-1", "锚1");
    // 批内新建二进制文件(含 NUL)
    std::fs::write(ws.dir.join("bin.dat"), [0u8, 1, 2, 3, 0, 9]).unwrap();
    ws.seal("cli-1", "tmd-1");

    let pv = restore_preview(ws.path(), &a.id, None).unwrap();
    assert_eq!(pv.rows.len(), 1);
    assert_eq!(pv.rows[0].path, "bin.dat");
    assert_eq!(pv.rows[0].kind, "D", "批内新建,回退 = 删除");
    assert_eq!(pv.rows[0].additions, 0, "binary 按 0/0 行计");
    assert_eq!(pv.rows[0].deletions, 0);

    // 磁盘原样(dry-run 不删文件)
    assert!(ws.dir.join("bin.dat").exists());
    let _ = a;
}

#[test]
fn preview_批内删除_恢复重建_a() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let a = ws.anchor("cli-1", "tmd-1", "锚1");
    // 轮内删除:批后像 = 不存在,批前像 = 基线 → 回退 = 重建文件
    std::fs::remove_file(ws.dir.join("a.txt")).unwrap();
    ws.seal("cli-1", "tmd-1");

    let pv = restore_preview(ws.path(), &a.id, None).unwrap();
    assert_eq!(pv.rows.len(), 1);
    assert_eq!(pv.rows[0].path, "a.txt");
    assert_eq!(pv.rows[0].kind, "A", "盘上已无,恢复 = 重建(恢复新增)");
    assert!(!pv.rows[0].overwrites);
    // dry-run 不重建文件
    assert!(!ws.dir.join("a.txt").exists());
    let _ = a;
}
