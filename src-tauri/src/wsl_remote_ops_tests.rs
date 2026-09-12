//! wsl_remote_ops 单测 —— 自主文件(文件规模铁则:主文件保命令装配与解析)。
use super::*;

#[test]
fn probe_lines_filter_interop_paths() {
    let probes = parse_probe_lines(
        "omp:/mnt/c/Users/CXN/AppData/Roaming/npm/omp\r\npi:/usr/local/bin/pi\r\nkimi:\r\nclaude:/usr/local/bin/claude",
    );
    assert_eq!(probes.len(), 4);
    assert_eq!(probes[0].bin, "omp");
    assert_eq!(
        probes[0].path, None,
        "/mnt/* Windows 互操作路径应视为未检出"
    );
    assert_eq!(probes[1].path.as_deref(), Some("/usr/local/bin/pi"));
    assert_eq!(probes[2].path, None, "空 path = 未检出");
    assert_eq!(probes[3].path.as_deref(), Some("/usr/local/bin/claude"));
}

#[test]
fn probe_lines_skip_garbage() {
    assert!(parse_probe_lines("").is_empty());
    // 无冒号的杂散行:bin 收下、path 视为空(宽容解析,与旧实现一致)
    let probes = parse_probe_lines("weird-line");
    assert_eq!(probes.len(), 1);
    assert_eq!(probes[0].bin, "weird-line");
    assert_eq!(probes[0].path, None);
}

#[test]
fn b64_roundtrip_and_wrapped_decode() {
    for sample in ["", "hello", "中文内容 utf-8 ✓", "line1\nline2\r\n\ttab"] {
        assert_eq!(
            String::from_utf8_lossy(&b64_decode(&b64_encode(sample.as_bytes())).unwrap()),
            sample
        );
    }
    // GNU base64 默认 76 列换行:解码须吞掉换行
    let encoded = b64_encode(b"authorized_keys content");
    let wrapped = encoded
        .as_bytes()
        .chunks(4)
        .map(|c| String::from_utf8_lossy(c).to_string())
        .collect::<Vec<_>>()
        .join("\n");
    assert_eq!(
        b64_decode(&wrapped).unwrap(),
        b"authorized_keys content".to_vec()
    );
    assert!(b64_decode("a").is_err());
    assert!(b64_decode("!!!!").is_err());
}

#[test]
fn parse_remote_file_text_protocol() {
    let text = "size=11\r\naGVsbG8gd29ybGQ="; // "hello world"
    let parsed = parse_remote_file_text(text).unwrap();
    assert_eq!(parsed.size, 11);
    assert_eq!(parsed.content.as_deref(), Some("hello world"));
    assert!(!parsed.truncated);
    // 超限形态:只有 size 行,无 b64 段
    let big = parse_remote_file_text("size=999999").unwrap();
    assert_eq!(big.size, 999999);
    assert_eq!(big.content, None);
    assert!(big.truncated);
    // 杂散输出(如 wsl 代理警告)前缀:取首个 size= 行,其后为 b64
    let noisy = parse_remote_file_text("wsl: warning\r\nsize=4\r\nYWJjZA==").unwrap();
    assert_eq!(noisy.content.as_deref(), Some("abcd"));
    assert!(parse_remote_file_text("").is_err());
}
