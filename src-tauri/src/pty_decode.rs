//! PTY/SSH 输出泵共用的增量 UTF-8 解码 —— 自 pty_spawn 拆出(文件规模铁则)。
//! 消费方:pty_spawn 输出泵、ssh/io.rs(经 `crate::pty_spawn::decode_utf8_chunk`
//! 再导出引用)与 pty_spawn_tests 单测——pty://out 的保真度不得取决于供血泵。

/// 增量 UTF-8 解码:不完整的多字节尾部暂存进 `tail`,与下一 chunk 拼接后再解码。
/// 真正的坏字节(error_len 存在)按 U+FFFD 替换;仅是"没读完"的字节绝不误伤。
pub(crate) fn decode_utf8_chunk(tail: &mut Vec<u8>, chunk: &[u8]) -> String {
    let mut bytes = std::mem::take(tail);
    bytes.extend_from_slice(chunk);

    let mut start = 0;
    let mut text = String::with_capacity(bytes.len());
    loop {
        match std::str::from_utf8(&bytes[start..]) {
            Ok(valid) => {
                text.push_str(valid);
                start = bytes.len();
                break;
            }
            Err(e) => {
                let up_to = start + e.valid_up_to();
                // 安全:valid_up_to 边界内必为合法 UTF-8
                text.push_str(unsafe { std::str::from_utf8_unchecked(&bytes[start..up_to]) });
                match e.error_len() {
                    Some(len) => {
                        text.push('\u{FFFD}');
                        start = up_to + len;
                    }
                    None => {
                        start = up_to;
                        break;
                    }
                }
            }
        }
    }
    tail.extend_from_slice(&bytes[start..]);
    text
}

/// 泵循环收尾:tail 残留 = 永远等不到后续字节的不完整 UTF-8 序列(进程最后
/// 输出的半个字符),按 U+FFFD 替换取出;空 tail 返回 None(无残留不补发)。
pub(crate) fn flush_utf8_tail(tail: &mut [u8]) -> Option<String> {
    if tail.is_empty() {
        return None;
    }
    Some(String::from_utf8_lossy(tail).into_owned())
}
