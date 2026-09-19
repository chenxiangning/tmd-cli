//! LSP Content-Length 组帧解析 —— 自 lsp.rs 拆出(文件规模铁则)。
//! 纯解析,无进程/协议语义:字节 buf → 完整 JSON-RPC 消息串(分包/粘包/坏头块)。

fn find_sub(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// 从头块解析 Content-Length(大小写不敏感);无该头返回 None。
fn content_length(header: &str) -> Option<usize> {
    header
        .split("\r\n")
        .filter_map(|line| line.split_once(':'))
        .find(|(k, _)| k.trim().eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.trim().parse().ok())
}

/// 帧提取:消费 buf 中的完整 JSON-RPC 消息(处理分包/粘包)。
/// 坏头块(有完整头尾但无 Content-Length)整块丢弃,不拖垮后续消息。
pub(crate) fn extract_messages(buf: &mut Vec<u8>) -> Vec<String> {
    let mut out = Vec::new();
    while let Some(hend) = find_sub(buf, b"\r\n\r\n") {
        let header = String::from_utf8_lossy(&buf[..hend]).into_owned();
        let Some(len) = content_length(&header) else {
            buf.drain(..hend + 4);
            continue;
        };
        if buf.len() < hend + 4 + len {
            break; // 消息体未到齐,等下一 chunk
        }
        let body = buf[hend + 4..hend + 4 + len].to_vec();
        buf.drain(..hend + 4 + len);
        out.push(String::from_utf8_lossy(&body).into_owned());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{content_length, extract_messages};

    fn frame(body: &str) -> Vec<u8> {
        format!("Content-Length: {}\r\n\r\n{}", body.len(), body).into_bytes()
    }

    #[test]
    fn 单帧一次到达() {
        let mut buf = frame(r#"{"jsonrpc":"2.0","id":1}"#);
        let out = extract_messages(&mut buf);
        assert_eq!(out, vec![r#"{"jsonrpc":"2.0","id":1}"#.to_string()]);
        assert!(buf.is_empty());
    }

    #[test]
    fn 消息体跨_chunk_分包() {
        let whole = frame(r#"{"m":"中文与emoji😀"}"#);
        let cut = whole.len() / 2;
        let mut buf = whole[..cut].to_vec();
        assert!(extract_messages(&mut buf).is_empty());
        buf.extend_from_slice(&whole[cut..]);
        assert_eq!(extract_messages(&mut buf).len(), 1);
    }

    #[test]
    fn 粘包两帧一次提取() {
        let mut buf = frame(r#"{"id":1}"#);
        buf.extend_from_slice(&frame(r#"{"id":2}"#));
        let out = extract_messages(&mut buf);
        assert_eq!(out.len(), 2);
        assert!(buf.is_empty());
    }

    #[test]
    fn 粘包_第二帧只到一半() {
        let second = frame(r#"{"id":2}"#);
        let mut buf = frame(r#"{"id":1}"#);
        buf.extend_from_slice(&second[..second.len() - 3]);
        let out = extract_messages(&mut buf);
        assert_eq!(out.len(), 1);
        assert_eq!(buf.len(), second.len() - 3); // 残留等待续 chunk
    }

    #[test]
    fn 坏头块丢弃不拖垮后续() {
        let mut buf = b"X-Garbage: 1\r\n\r\n".to_vec();
        buf.extend_from_slice(&frame(r#"{"id":9}"#));
        let out = extract_messages(&mut buf);
        assert_eq!(out, vec![r#"{"id":9}"#.to_string()]);
    }

    #[test]
    fn 头部字段大小写不敏感() {
        assert_eq!(content_length("content-length: 42"), Some(42));
        assert_eq!(content_length("Content-Length:\t7"), Some(7));
        assert_eq!(content_length("Content-Type: x"), None);
    }
}
