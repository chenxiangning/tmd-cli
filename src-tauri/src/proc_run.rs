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
//! exit_on_stdout:stdout 出现该子串 = 应答头部到达(读线程继续排空管道),
//! 主线程宽限 500ms 后杀树收割 —— marker 在应答头部而非尾部,命中即杀会
//! 斩断应答尾部(2026-09-08 omp 实证:16KB 块界 + 扩展噪声把应答推入后续
//! 读取块,提前 return + SIGKILL 令尾部 ~7KB 随管道消亡,JSON 永不完整)。
//! 超时:timeout_ms 到点强杀。
//!
//! 阻塞安全:调用方(lib.rs)必须 async + spawn_blocking,本模块全同步。
//! 收割杀整棵进程树:Windows 下 npm shim(.cmd)是 cmd /c 包裹,只杀直接
//! 子进程会让孙进程 node 握住 stdout 管道 → 读线程永不 EOF → join 挂起
//! 泄漏,复用 resolve::kill_tree(taskkill /T;unix 无 wrapper 直接 kill)。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::resolve::{enriched_path, hide_console, kill_tree, resolve_command};

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
    /// stdin 以 null 启动(立即 EOF)而非保持管道。一次性 CLI(omp/pi/opencode
    /// 的 `-p`/`run`)检测到管道 stdin 会等 EOF,永不关闭即挂到超时
    /// (2026-09-06 d 路实证:"Reading prompt from piped stdin… Still starting
    /// after 10s")。默认 false:RPC 副车需 stdin 保活,关了丢响应(见文件头)。
    #[serde(default)]
    pub close_stdin: bool,
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
        .current_dir(&spec.cwd);
    let needs_stdin_pipe = spec.close_stdin || spec.stdin.is_some();
    cmd.stdin(if needs_stdin_pipe {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
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
        let mut matched = false;
        if let Some(out) = stdout.as_mut() {
            loop {
                match out.read(&mut chunk) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        buf.extend_from_slice(&chunk[..n]);
                        if let Some(needle) = &needle {
                            // marker 在应答头部:命中后必须继续排空管道,应答尾部
                            // 由主线程宽限后收割杀树收尾,此处绝不提前 return。
                            if !matched && find(&buf, needle) {
                                matched = true;
                                let _ = tx.send(Signal::Matched);
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

    // stdin 一次性写入(会话尾段指令 ≤ ~6KB + 小 RPC 体,远小于 64KB 管道
    // 缓冲;正确性依赖消费方读 stdin —— omp/pi/opencode print 模式启动路径
    // 必读到 EOF)。close_stdin = 写完(或无数据)即关管道送 EOF —— 一次性
    // CLI 等 EOF 才返回;RPC 副车不开 close,管道保活等响应。
    if let Some(text) = &spec.stdin {
        if let Some(pipe) = stdin.as_mut() {
            let _ = pipe.write_all(text.as_bytes());
            let _ = pipe.flush();
        }
    }
    if spec.close_stdin {
        drop(stdin.take());
    }

    let deadline = Instant::now() + Duration::from_millis(spec.timeout_ms);
    // marker 命中只说明应答头部到达:宽限一拍让 omp 把应答尾部写完,再收割
    // 杀树(杀树令管道 EOF,读线程随之收工 join)。EOF/Disconnected 时读线程
    // 已收工,纯等待无收益,立即收割;超时分支直接进杀树,语义不变。
    let timed_out = match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        Ok(Signal::Matched) => {
            std::thread::sleep(Duration::from_millis(500));
            false
        }
        Ok(Signal::Eof) | Err(RecvTimeoutError::Disconnected) => false,
        Err(RecvTimeoutError::Timeout) => true,
    };
    kill_tree(&mut child);
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
#[path = "proc_run_tests.rs"]
mod tests;
