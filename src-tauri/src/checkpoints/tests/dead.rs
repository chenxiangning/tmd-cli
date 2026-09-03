//! 死锚点收口测试(强退恢复)—— tests.rs 的姊妹模块(文件规模铁则)。
//! 覆盖:kill 掉 sessionExited 的最后一轮由 seal_dead_turns 落账、
//! 新鲜度宽限保护在途轮、幂等再收、与显式封口的修订互不重复。

use super::*;
use super::super::seal_dead_turns;

#[test]
fn 死锚点收口_强退最后一轮落账() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    // 强退模拟:锚点后 AI 改了文件,kill 掉 sessionExited,永远等不到显式封口
    let _ = ws.anchor("cli-1", "tmd-1", "被强退的一轮");
    ws.write("a.txt", "v2\n");

    // 新鲜度保护:宽限内的在途锚点不收(本运行刚打的轮),但 open 批在时间线可见
    assert_eq!(
        seal_dead_turns(ws.path(), 60_000).unwrap(),
        0,
        "宽限内的在途锚点不代封"
    );
    let open = ws.batches("cli-1");
    assert_eq!(open.len(), 1);
    assert!(open[0].open, "未封口 = 进行中");

    // 启动恢复语义(grace 0):死锚点代为封口,最后一轮落账
    assert_eq!(seal_dead_turns(ws.path(), 0).unwrap(), 1);
    let batches = ws.batches("cli-1");
    assert_eq!(batches.len(), 1);
    assert!(!batches[0].open, "轮已关闭");
    assert_eq!(batches[0].files.len(), 1);
    assert_eq!(batches[0].files[0].path, "a.txt");
    assert_eq!(batches[0].files[0].live, "same", "内容 == 批后像,可回退");

    // 幂等:再收一次,无新封口;显式 seal 不再追加
    assert_eq!(seal_dead_turns(ws.path(), 0).unwrap(), 0);
    assert!(!ws.seal("cli-1", "tmd-1"), "同修订不重复落行");
}

#[test]
fn 死锚点收口_按会话隔离_不吞别人窗口() {
    let ws = TempWs::new();
    ws.write("a.txt", "v1\n");
    ws.commit_all("init");

    // 会话 A 强退留下开放锚点;会话 B 在其后提示并写入
    ws.anchor("dead-1", "dead-1", "被强退的一轮");
    ws.write("a.txt", "v2\n");
    ws.anchor("live-1", "live-1", "B 的一轮");
    ws.write("b.txt", "new\n");

    // grace 0 下刚打的 live 锚点也可能超龄被一并代封(修订追加,无损失);
    // 要钉的契约是:收口不吞别人窗口,各会话批各归各的变更
    seal_dead_turns(ws.path(), 0).unwrap();

    // A 的批 = 自己窗口内的 a.txt;B 的批 = 自己窗口内的 b.txt
    let a = ws.batches("dead-1");
    assert_eq!(a.len(), 1);
    assert_eq!(a[0].files.len(), 1);
    assert_eq!(a[0].files[0].path, "a.txt");
    let b = ws.batches("live-1");
    assert_eq!(b.len(), 1);
    assert_eq!(b[0].files.len(), 1);
    assert_eq!(b[0].files[0].path, "b.txt", "mtime 窗口仲裁:最近提示者赢");
}
