//! mcp_probe.rs 的单元测试(文件规模铁则拆出;经 #[path] 挂回 mcp_probe::tests)。

use super::*;

/// POSIX sh 桩服务:按 method 回应 initialize / tools_list,其余行忽略。 */
const STUB: &str = r#"while IFS= read -r line; do case "$line" in
*'"method":"initialize"'*) printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"stub","version":"1.2"}}}' ;;
*'"method":"tools/list"'*) printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"tools":[{},{}]}}' ;;
esac; done"#;

fn spec(command: &str, args: &[&str], timeout_ms: u64) -> McpProbeSpec {
    McpProbeSpec {
        command: command.to_string(),
        args: args.iter().map(|s| s.to_string()).collect(),
        env: HashMap::new(),
        timeout_ms: Some(timeout_ms),
    }
}

#[test]
fn 探活成功_带回serverinfo与工具数() {
    let r = run_probe(spec("sh", &["-c", STUB], 10_000));
    assert!(r.ok, "error = {:?}", r.error);
    assert_eq!(r.server_name.as_deref(), Some("stub"));
    assert_eq!(r.server_version.as_deref(), Some("1.2"));
    assert_eq!(r.tools_count, Some(2));
}

#[test]
fn 沉默进程_超时失败且收尸() {
    let r = run_probe(spec("sh", &["-c", "sleep 30"], 400));
    assert!(!r.ok);
    assert!(r.error.as_deref().unwrap().contains("超时"));
}

#[test]
fn 秒退进程_提前退出且附stderr尾() {
    let r = run_probe(spec(
        "sh",
        &["-c", "echo boom-one >&2; echo boom-two >&2; exit 0"],
        10_000,
    ));
    assert!(!r.ok);
    let err = r.error.unwrap();
    assert!(
        err.contains("boom-one") && err.contains("boom-two"),
        "err = {err}"
    );
}

#[test]
fn 报错应答_版本回退后仍败_带错误文案() {
    let stub = r#"while IFS= read -r line; do case "$line" in
*'"method":"initialize"'*) printf '%s\n' '{"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"bad version"}}' ;;
esac; done"#;
    let r = run_probe(spec("sh", &["-c", stub], 10_000));
    assert!(!r.ok);
    assert!(r
        .error
        .as_deref()
        .unwrap()
        .contains("initialize 被拒: bad version"));
}
