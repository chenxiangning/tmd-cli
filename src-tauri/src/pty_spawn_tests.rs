//! pty_spawn 单测 —— 自主文件(文件规模铁则:主文件保 spawn 管线本身)。
//! ConPTY CPR 回归测见文末;仅 Windows 有 ConPTY 握手语义。
use super::*;

#[test]
fn decode_utf8_chunk_多字节字符跨包不产生替换符() {
    /* "输出中" 共 9 字节;切在 7 = "中" 的 3 字节被劈成 1 + 2,模拟 8KB chunk 边界 */
    let bytes = "输出中".as_bytes();
    let cut = 7;
    let mut tail = Vec::new();
    let first = decode_utf8_chunk(&mut tail, &bytes[..cut]);
    let second = decode_utf8_chunk(&mut tail, &bytes[cut..]);
    assert_eq!(format!("{first}{second}"), "输出中");
    assert!(!first.contains('\u{FFFD}'));
    assert!(tail.is_empty());
}

#[test]
fn decode_utf8_chunk_真正的坏字节才替换() {
    let mut tail = Vec::new();
    let text = decode_utf8_chunk(&mut tail, &[0xff, b'a']);
    assert_eq!(text, "\u{FFFD}a");
}

#[test]
fn flush_utf8_tail_泵尾残留的不完整序列补替换符() {
    /* "中"(UTF-8: E4 B8 AD)只到了 2 字节进程就退出:残留 tail 按 U+FFFD 补发 */
    let mut tail = vec![0xE4, 0xB8];
    assert_eq!(flush_utf8_tail(&mut tail), Some("\u{FFFD}".to_string()));
}

#[test]
fn flush_utf8_tail_空尾不补发() {
    let mut tail = Vec::new();
    assert_eq!(flush_utf8_tail(&mut tail), None);
}

/* 自适应窗契约:洪峰逐批翻倍封顶 50ms;孤立小块回 8ms 基线;中批保持现窗。
 * 窗长打错 = 高吞吐场景事件风暴回归(前端主线程饱和卡死的输入侧放大器)。 */
#[test]
fn 自适应窗_洪峰翻倍封顶_小块回基线_中批保持() {
    let base = Duration::from_millis(8);
    let mut w = base;
    /* 洪峰:每批排满窗口 → 8→16→32→50→50(封顶) */
    w = next_aggregate_window(w, true, 4096);
    assert_eq!(w, Duration::from_millis(16));
    w = next_aggregate_window(w, true, 4096);
    assert_eq!(w, Duration::from_millis(32));
    w = next_aggregate_window(w, true, 4096);
    assert_eq!(w, Duration::from_millis(50));
    w = next_aggregate_window(w, true, 4096);
    assert_eq!(w, Duration::from_millis(50));
    /* 孤立小块(击键回显):回基线 */
    w = next_aggregate_window(w, false, 64);
    assert_eq!(w, base);
    /* 中批未排满窗口:保持现窗(洪峰间歇不降级) */
    w = next_aggregate_window(w, true, 4096);
    w = next_aggregate_window(w, false, 1024);
    assert_eq!(w, Duration::from_millis(16));
}

/* 端到端锁死回归:ConPTY(INHERIT_CURSOR)启动即在输出侧发 DSR 并扣住
输出等 CPR 应答。按 spawn() 的真实顺序建 ConPTY + 经 conpty_cpr_reply
代答,断言 10s 内读到 cmd 的输出字节;有人移除代答此测必红。 */
#[cfg(windows)]
#[test]
fn windows_conpty_启动输出在_cpr_代答后流动() {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("openpty");
    let child = pair
        .slave
        .spawn_command(CommandBuilder::new("cmd.exe"))
        .expect("spawn cmd.exe");
    let mut reader = pair.master.try_clone_reader().expect("clone reader");
    let mut writer = pair.master.take_writer().expect("take writer");
    conpty_cpr_reply(&mut *writer).expect("cpr reply");
    drop(pair.slave);
    let (tx, rx) = mpsc::channel::<()>();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        /* 首个 chunk 到达即回报;读到字节 = 输出在流动 */
        let n = reader.read(&mut buf).unwrap_or(0);
        if n > 0 {
            let _ = tx.send(());
        }
        let mut child = child;
        let _ = child.kill();
    });
    /* ConPTY 扣住输出时此 recv 必超时:10s 内来字节 = 代答有效 */
    assert!(rx.recv_timeout(Duration::from_secs(10)).is_ok());
}

/* 后台聚合降档契约(2026-10-04 十一轮):无人观看/渲染暂停的会话钳到 250ms
 * 慢拍 —— TUI 状态动画洪水(实测 20-100KB/s 持续数十分钟)不再以快拍穿越
 * IPC/webview 主链;前台保持自适应窗(可见面延迟零改动)。窗长打错 = 降档
 * 失效(主线程饱和回归)或可见面延迟回归,两头都要钉。 */
#[test]
fn 有效聚合窗_前台保持自适应_后台钳到慢拍() {
    let base = Duration::from_millis(8);
    /* 前台:原样透传(8ms 基线与 50ms 饱和窗都不动) */
    assert_eq!(effective_window(base, true), base);
    assert_eq!(
        effective_window(Duration::from_millis(50), true),
        Duration::from_millis(50)
    );
    /* 后台:钳到 250ms 慢拍(比自适应窗更长的窗取其大) */
    assert_eq!(effective_window(base, false), Duration::from_millis(250));
    assert_eq!(
        effective_window(Duration::from_millis(50), false),
        Duration::from_millis(250)
    );
}
