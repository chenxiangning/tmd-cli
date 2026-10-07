//! 标注存证链测试(W2)—— tests.rs 的姊妹模块(文件规模铁则)。
//! 覆盖:锚点携带 marks_refs 落账、seal 修订行携带(turn 行 = 同 id 修订,
//! 读取以最后一行为准)、list 回读(open 批与 sealed 批)、旧账本行缺省兼容。

use super::*;
use crate::checkpoints::{load_ledger, record_edit, CkptMarkRef};

#[test]
fn 标注存证_锚点携带_封口继承_列表回读_旧账本兼容() {
    let ws = TempWs::new();
    ws.write("a.txt", "l1\nl2\nl3\n");
    ws.commit_all("init");

    // 轮 1:带标注引用锚点 → 改写 → 封口(turn 修订行必须携带 marks_refs)
    let marks = vec![CkptMarkRef {
        mark_id: "m1".into(),
        path: "a.txt".into(),
        start_line: 2,
        end_line: 3,
    }];
    anchor_turn(
        ws.path(),
        "cli-1",
        "tmd-1",
        "改这两处",
        "omp",
        "glm-5.3",
        "high",
        &marks,
        "git",
    )
    .unwrap();
    ws.write("a.txt", "l1\nL2\nL3\n");
    assert!(ws.seal("cli-1", "tmd-1"));

    // 对账本本体断言(非视图):turn 修订行(最后一行为准)必须携带 marks_refs
    // ——视图从 anchor 行取,只验视图删掉复制也绿(P2 2026-10-07 评审)。
    {
        let ledger = load_ledger(ws.path());
        let turn = ledger
            .iter()
            .find(|e| e.kind == "turn")
            .expect("seal 落 turn 行");
        assert_eq!(turn.marks_refs, marks, "turn 修订行继承锚点 marks_refs");
    }

    let batches = ws.batches("cli-1");
    assert_eq!(batches.len(), 1);
    assert_eq!(
        batches[0].marks_refs, marks,
        "sealed 批回读锚点携带的标注引用"
    );

    // 轮 2:无标注锚点 + 窗口内真实变更 → open 批回读(纯阅读轮不上时间线)
    anchor_turn(
        ws.path(),
        "cli-1",
        "tmd-1",
        "下一轮",
        "omp",
        "",
        "",
        &[],
        "git",
    )
    .unwrap();
    ws.write("b.txt", "new\n");
    let batches = ws.batches("cli-1");
    assert_eq!(batches.len(), 2);
    assert_eq!(
        batches[0].marks_refs,
        Vec::<CkptMarkRef>::new(),
        "open 批未携带 = 空"
    );
    assert_eq!(batches[1].marks_refs, marks, "sealed 轮 1 仍回读 m1");

    // 旧账本兼容:缺 marksRefs 字段的裸行反序列化为空数组
    let legacy =
        r#"{"id":"legacy1","kind":"anchor","ts":1,"sessionId":"cli-1","turn":9,"prompt":"旧"}"#;
    fs::write(
        crate::checkpoints::store::ws_dir(ws.path()).join("ledger.jsonl"),
        format!("{legacy}\n"),
    )
    .unwrap();
    let reloaded = crate::checkpoints::store::load_ledger(ws.path());
    let legacy_entry = reloaded.iter().find(|e| e.id == "legacy1").unwrap();
    assert!(
        legacy_entry.marks_refs.is_empty(),
        "旧账本行缺省 = 空数组不报错"
    );
}

#[test]
fn 标注存证_events_净零封口行也继承_marks() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    let marks = vec![CkptMarkRef {
        mark_id: "m1".into(),
        path: "a.txt".into(),
        start_line: 1,
        end_line: 1,
    }];
    anchor_turn(
        ws.path(),
        "cli-1",
        "tmd-1",
        "看一眼就好",
        "omp",
        "",
        "",
        &marks,
        "events",
    )
    .unwrap();
    // 写了又写回:净零轮(events 归因也要落空 turn 行关轮)
    assert!(record_edit(ws.path(), "cli-1", "tmd-1", "a.txt", None).unwrap());
    ws.write("a.txt", "v2\n");
    assert!(record_edit(ws.path(), "cli-1", "tmd-1", "a.txt", None).unwrap());
    ws.write("a.txt", "v1\n");
    assert!(ws.seal("cli-1", "tmd-1"));

    let ledger = load_ledger(ws.path());
    let turn = ledger
        .iter()
        .find(|e| e.kind == "turn")
        .expect("净零轮落 turn 行");
    assert!(turn.turn_files.is_empty(), "净零关轮,无变更集");
    assert_eq!(turn.marks_refs, marks, "净零 turn 行同样继承 marks_refs");
}
