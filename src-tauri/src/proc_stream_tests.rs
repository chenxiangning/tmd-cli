//! proc_stream 纯逻辑测试:行读取器(截断/UTF-8/EOF)。spawn/kill 生命周期
//! 依赖 AppHandle 事件面,由前端桩目检与真机验收覆盖(design spec 验证节)。

use super::read_limited_line;
use std::io::Cursor;

#[test]
fn line_reader_splits_and_handles_eof() {
    let mut src = Cursor::new(b"line1\nline2\n".to_vec());
    let mut out = String::new();
    assert_eq!(read_limited_line(&mut src, &mut out).unwrap(), 6); // 含换行;0 仅 EOF
    assert_eq!(out, "line1");
    out.clear();
    assert_eq!(read_limited_line(&mut src, &mut out).unwrap(), 6);
    assert_eq!(out, "line2");
    out.clear();
    assert_eq!(read_limited_line(&mut src, &mut out).unwrap(), 0); // EOF
    assert!(out.is_empty());
}

#[test]
fn line_reader_blank_line_is_not_eof() {
    let mut src = Cursor::new(b"\nnext\n".to_vec());
    let mut out = String::new();
    assert_eq!(read_limited_line(&mut src, &mut out).unwrap(), 1); // 空行 ≠ EOF
    assert_eq!(out, "");
    out.clear();
    read_limited_line(&mut src, &mut out).unwrap();
    assert_eq!(out, "next");
}

#[test]
fn line_reader_keeps_multibyte_utf8_intact() {
    let mut src = Cursor::new("思考中…\n".as_bytes().to_vec());
    let mut out = String::new();
    read_limited_line(&mut src, &mut out).unwrap();
    assert_eq!(out, "思考中…");
}

#[test]
fn line_reader_truncates_runaway_line() {
    let huge = vec![b'a'; 5 * 1024 * 1024];
    let mut data = huge;
    data.push(b'\n');
    let mut src = Cursor::new(data);
    let mut out = String::new();
    let n = read_limited_line(&mut src, &mut out).unwrap();
    assert!(n >= super::MAX_LINE_BYTES); // 全行已吞(截断标记在 out 内)
    assert!(out.ends_with("…[truncated]"));
    assert!(out.len() < 5 * 1024 * 1024);
    // 下一行不受污染
    out.clear();
    let mut next = Cursor::new(b"next\n".to_vec());
    read_limited_line(&mut next, &mut out).unwrap();
    assert_eq!(out, "next");
}
