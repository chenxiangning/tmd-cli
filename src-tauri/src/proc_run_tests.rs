//! proc_run 单测(规模铁则拆出,先例 conn_tests / path_cache_tests)。

use super::*;

fn spec(command: &str, args: &[&str], timeout_ms: u64) -> ProcRunSpec {
    ProcRunSpec {
        command: command.into(),
        args: args.iter().map(|s| s.to_string()).collect(),
        cwd: std::env::temp_dir().to_string_lossy().into_owned(),
        env: HashMap::new(),
        stdin: None,
        exit_on_stdout: None,
        close_stdin: false,
        timeout_ms,
    }
}

#[test]
fn close_stdin_gives_immediate_eof() {
    // close_stdin 无数据 = 管道建立后立即关闭送 EOF(等价旧 null 语义),
    // cat 自然退出(code 0)而非挂到超时。
    // 对齐一次性 CLI(omp -p 等)读管道 stdin 等 EOF 的真实行为。
    // 历史三红(2026-09-21/27/30)根因不是 runner 慢:run 的 EOF 路径原先
    // 无条件 SIGKILL,落在「exit 已关 stdio、尚未 exit_group」窗口内会把
    // exited(0) 改判 signal 死 → code=None;现已改自然收割。先断 timed_out
    // 防再误诊为超时;上限 120s 只防回归挂死。
    let mut s = spec("cat", &[], 120_000);
    s.close_stdin = true;
    let r = run(&s).unwrap();
    assert!(!r.timed_out);
    assert_eq!(r.code, Some(0));
}

#[test]
fn captures_stdout_and_exit_code() {
    // 同一 EOF 收割路径:历史 5s/30s 上限下的 code=None 实为「已关 stdio、
    // 未 exit_group 窗口内被 SIGKILL 改判」,非 runner 慢(见上测试注释);
    // 先断 timed_out,让真超时红日志直说「超时」。
    let r = run(&spec("echo", &["tmd-proc-run-ok"], 120_000)).unwrap();
    assert!(!r.timed_out);
    assert_eq!(r.code, Some(0));
    assert!(r.stdout.contains("tmd-proc-run-ok"));
}

#[cfg(unix)]
#[test]
fn stdin_is_fed_and_read() {
    let mut s = spec("cat", &[], 30_000); // stdin 保持打开设计:cat 等 EOF 到 deadline 收割,
                                          // 此上限是收割时延参数(吃满属预期),非环境容差——勿与 captures 的 120s 混淆
    s.stdin = Some("tmd-stdin-payload\n".into());
    let r = run(&s).unwrap();
    assert!(r.stdout.contains("tmd-stdin-payload"));
}

#[cfg(unix)]
#[test]
fn stdin_with_close_stdin_feeds_then_eof() {
    // stdin 数据 + close_stdin 兼用:payload 必须送达(此前 close_stdin=true
    // 直接 null stdin,数据被静默丢弃),且 EOF 后 cat 自然退出(2026-09-28
    // 评审:memory 代写指令改走 stdin,argv 不再携带动态文本)。
    let mut s = spec("cat", &[], 30_000);
    s.stdin = Some("tmd-stdin-close-payload\n".into());
    s.close_stdin = true;
    let r = run(&s).unwrap();
    assert!(r.stdout.contains("tmd-stdin-close-payload"));
    assert_eq!(r.code, Some(0));
    assert!(!r.timed_out);
}

/// Windows 变体:主审计平台对「数据+关管道」组合路径的覆盖(more 读 stdin
/// 回显,cmd.exe 直跑非批处理不经 shim 包裹)。
#[cfg(windows)]
#[test]
fn stdin_with_close_stdin_feeds_then_eof_windows() {
    let mut s = spec("cmd", &["/c", "more"], 30_000);
    s.stdin = Some("tmd-stdin-close-payload\r\n".into());
    s.close_stdin = true;
    let r = run(&s).unwrap();
    assert!(
        r.stdout.contains("tmd-stdin-close-payload"),
        "stdout={}",
        r.stdout
    );
    assert_eq!(r.code, Some(0));
    assert!(!r.timed_out);
}

#[cfg(unix)]
#[test]
fn exit_on_stdout_harvests_early() {
    let start = Instant::now();
    let mut s = spec("sh", &["-c", "echo READY; exec sleep 30"], 29_000);
    s.exit_on_stdout = Some("READY".into());
    let r = run(&s).unwrap();
    assert!(r.stdout.contains("READY"));
    assert!(!r.timed_out);
    assert!(
        start.elapsed() < Duration::from_secs(20),
        "必须提前收割,不能等满超时"
    );
}

#[cfg(unix)]
#[test]
fn timeout_kills_hung_process() {
    let start = Instant::now();
    let r = run(&spec("sleep", &["30"], 600)).unwrap();
    assert!(r.timed_out);
    assert!(start.elapsed() < Duration::from_secs(10));
}

#[cfg(unix)]
#[test]
fn missing_binary_is_error() {
    let r = run(&spec("tmd-definitely-not-exists", &[], 2_000));
    assert!(r.is_err());
}
/* 真实 omp RPC 副车端到端(stdin 请求 + exitOnStdout marker 提前收割)。
 * 依赖本机装有 omp;仅本地诊断用,CI 无 omp 时忽略。 */
#[test]
fn omp_rpc_sidecar_real_probe() {
    if std::env::var("TMD_REAL_SIDECAR_PROBE").is_err() {
        eprintln!("TMD_REAL_SIDECAR_PROBE=1 才跑(依赖本机 omp)");
        return;
    }
    let marker = format!("tmd-real-{}", std::process::id());
    let mut s = spec("omp", &["--mode", "rpc", "--no-session"], 25_000);
    s.cwd = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    s.stdin = Some(format!(
        "{{\"type\":\"get_available_commands\",\"id\":\"{marker}\"}}\n"
    ));
    s.exit_on_stdout = Some(marker.clone());
    let r = run(&s).expect("run ok");
    assert!(!r.timed_out, "timed_out; stderr={}", r.stderr);
    // 严格断言:marker 所在行必须是完整可解析的应答(尾部不被收割斩断)。
    let line = r
        .stdout
        .lines()
        .find(|l| l.contains(marker.as_str()))
        .expect("marker 行存在");
    let v: serde_json::Value = serde_json::from_str(line).expect("应答行必须是完整 JSON");
    assert_eq!(v["success"], serde_json::json!(true));
    assert!(
        v["data"]["commands"]
            .as_array()
            .is_some_and(|a| !a.is_empty()),
        "commands 非空"
    );
}
