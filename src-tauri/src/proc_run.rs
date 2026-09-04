//! 通用短进程通道 —— spawn + stdin 写入 + stdout/stderr 收割 + 提前收割/超时杀树。
//!
//! 消费方:omp/pi 的 RPC 副车一次性查询、grok inspect --json(cli-shared/cliQuery
//! 统一封装)。内核不懂任何 CLI 协议:本模块只有"跑一个进程、喂文本、按标记
//! 或超时收尸"的通用语义。
//!
//! 关键语义(2026-09-04 实测,omp/pi 双家):RPC server 在 stdin 立即 EOF 时
//! 会在处理排队请求前退出 → 响应丢失。因此 stdin 写入后**保持打开**(句柄
//! 存活到收割),由 kill 收尸时随进程一并终结 —— 绝不主动 close 触发 EOF。
//!
//! exit_on_stdout:stdout 累计缓冲里出现该子串即提前杀进程返回(响应已到达,
//! 省掉等超时)。超时:timeout_ms 到点强杀。两者都不命中则等进程自然退出。
//!
//! 阻塞安全:调用方(lib.rs)必须 async + spawn_blocking,本模块全同步。
//! 只杀直接子进程:被查的 CLI 起深层子进程的场景暂不存在,不做进程树追杀。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::resolve::{enriched_path, hide_console, resolve_command};

/// 单次收割的 stdout 上限:正常查询响应 ≤ 几十 KB,8MB 已是异常,触顶即杀。
const MAX_CAPTURE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcRunSpec {
    /// 程序名(PATH 解析与 PTY 同源)或绝对路径。
    pub command: String,
    pub args: Vec<String>,
    /// 工作目录(CLI 按此发现项目级扩展/技能)。
    pub cwd: String,
    /// 附加环境变量(叠加在继承环境之上)。
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// 启动后一次性写入 stdin 的文本;写入后保持管道打开,直到收割。
    #[serde(default)]
    pub stdin: Option<String>,
    /// stdout 出现该子串即提前收割。
    #[serde(default)]
    pub exit_on_stdout: Option<String>,
    pub timeout_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcRunResult {
    pub stdout: String,
    pub stderr: String,
    /// 退出码;被强杀时可能为 None(信号终止)。
    pub code: Option<i32>,
    /// true = 超时强杀;false = exit_on_stdout 命中或进程自然退出。
    pub timed_out: bool,
}

/// 收割事件:stdout 线程发出的两态信号。
enum Signal {
    /// exit_on_stdout 命中。
    Matched,
    /// stdout EOF(进程退出/管道关闭)或触顶。
    Eof,
}

pub fn run(spec: &ProcRunSpec) -> Result<ProcRunResult, String> {
    let resolved = resolve_command(&spec.command, &enriched_path());
    let mut cmd = Command::new(resolved.program);
    cmd.args(resolved.prefix_args)
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in &spec.env {
        cmd.env(k, v);
    }
    hide_console(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn {} 失败: {e}", spec.command))?;

    let mut stdin = child.stdin.take();
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();

    let needle = spec.exit_on_stdout.clone();
    let (tx, rx) = mpsc::channel::<Signal>();
    let t_out = std::thread::spawn(move || {
        let mut buf: Vec<u8> = Vec::with_capacity(8 * 1024);
        let mut chunk = [0u8; 16 * 1024];
        if let Some(out) = stdout.as_mut() {
            loop {
                match out.read(&mut chunk) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        buf.extend_from_slice(&chunk[..n]);
                        if let Some(needle) = &needle {
                            if find(&buf, needle) {
                                let _ = tx.send(Signal::Matched);
                                return buf;
                            }
                        }
                        if buf.len() > MAX_CAPTURE_BYTES {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        }
        let _ = tx.send(Signal::Eof);
        buf
    });
    let t_err = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(err) = stderr.as_mut() {
            let _ = err.read_to_end(&mut buf);
        }
        buf
    });

    // stdin 一次性写完(请求体 ≤ 几百字节,远小于 64KB 管道缓冲,无死锁面),
    // 句柄故意不 close:close = EOF = 两家 RPC 丢响应。
    if let Some(text) = &spec.stdin {
        if let Some(pipe) = stdin.as_mut() {
            let _ = pipe.write_all(text.as_bytes());
            let _ = pipe.flush();
        }
    }

    let deadline = Instant::now() + Duration::from_millis(spec.timeout_ms);
    let timed_out = match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        Ok(Signal::Matched) | Ok(Signal::Eof) | Err(RecvTimeoutError::Disconnected) => false,
        Err(RecvTimeoutError::Timeout) => true,
    };
    // 收割即杀:exit_on_stdout 命中时响应已拿全;EOF 时进程多半已退,kill 幂等。
    let _ = child.kill();
    let code = child.wait().ok().and_then(|s| s.code());
    let out_bytes = t_out.join().unwrap_or_default();
    let err_bytes = t_err.join().unwrap_or_default();

    Ok(ProcRunResult {
        stdout: String::from_utf8_lossy(&out_bytes).into_owned(),
        stderr: String::from_utf8_lossy(&err_bytes).into_owned(),
        code,
        timed_out,
    })
}

/// 子串搜索(字节级;needle 为 UTF-8,吻合 UTF-8 流式截断的边界容错:
/// 最坏情况多读一次 chunk 才命中,不影响正确性)。
fn find(haystack: &[u8], needle: &str) -> bool {
    let n = needle.as_bytes();
    haystack.windows(n.len()).any(|w| w == n)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(command: &str, args: &[&str], timeout_ms: u64) -> ProcRunSpec {
        ProcRunSpec {
            command: command.into(),
            args: args.iter().map(|s| s.to_string()).collect(),
            cwd: std::env::temp_dir().to_string_lossy().into_owned(),
            env: HashMap::new(),
            stdin: None,
            exit_on_stdout: None,
            timeout_ms,
        }
    }

    #[test]
    fn captures_stdout_and_exit_code() {
        let r = run(&spec("echo", &["tmd-proc-run-ok"], 5_000)).unwrap();
        assert_eq!(r.code, Some(0));
        assert!(!r.timed_out);
        assert!(r.stdout.contains("tmd-proc-run-ok"));
    }

    #[cfg(unix)]
    #[test]
    fn stdin_is_fed_and_read() {
        let mut s = spec("cat", &[], 5_000);
        s.stdin = Some("tmd-stdin-payload\n".into());
        let r = run(&s).unwrap();
        assert!(r.stdout.contains("tmd-stdin-payload"));
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
}
