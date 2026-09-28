//! 一次性 MCP stdio 探活 —— spawn → initialize(协议版本自新向旧)→
//! tools/list → kill。上游调研否决长驻 MCP client(模型侧消费者是各 CLI,
//! tmd 起的进程模型看不见),本命令是唯一保留的探活例外:一次性握手,无
//! 常驻 session/注册表。消费方 mcp-hub 插件(连通测试按钮)。
//!
//! 语义:JSON-RPC 按行(stdio);响应按 id 匹配,通知/日志行跳过;版本协商
//! 只在服务端显式报错时逐级回退(超时/断管不重试);结束后无条件收尸
//! (kill_tree,resolve/mod.rs 同款);失败附 stderr 尾 5 行。

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::resolve::{enriched_path, hide_console, kill_tree, resolve_command};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpProbeSpec {
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpProbeResult {
    pub ok: bool,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub tools_count: Option<usize>,
    pub error: Option<String>,
}

const DEFAULT_TIMEOUT_MS: u64 = 15_000;
/// 协议版本候选(自新向旧;服务端不支持时报错逐级回退)。
const PROTOCOL_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];
/// stderr 尾行上限(错误文案只附尾行)。
const STDERR_TAIL: usize = 5;
/// 等待目标应答时可跳过的噪声行上限(通知/日志)。
const MAX_SKIPPED_LINES: usize = 200;

#[tauri::command(rename_all = "snake_case")]
pub async fn mcp_probe(spec: McpProbeSpec) -> McpProbeResult {
    tauri::async_runtime::spawn_blocking(move || run_probe(spec))
        .await
        .unwrap_or_else(|e| fail(format!("探活线程异常: {e}"), None))
}

fn fail(message: String, stderr_tail: Option<Vec<String>>) -> McpProbeResult {
    let error = match stderr_tail {
        Some(tail) if !tail.is_empty() => format!("{message}\n{}", tail.join("\n")),
        _ => message,
    };
    McpProbeResult {
        ok: false,
        server_name: None,
        server_version: None,
        tools_count: None,
        error: Some(error),
    }
}

fn run_probe(spec: McpProbeSpec) -> McpProbeResult {
    let timeout_ms = spec
        .timeout_ms
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(100, 120_000);
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);

    let resolved = resolve_command(&spec.command, &enriched_path());
    let mut cmd = Command::new(&resolved.program);
    cmd.args(&resolved.prefix_args)
        .args(&spec.args)
        .envs(&spec.env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut cmd);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return fail(format!("启动失败({}): {e}", resolved.program), None),
    };

    let stdin = child.stdin.take();
    let (tx, rx) = mpsc::channel::<String>();
    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(l) if !l.trim().is_empty() => {
                        if tx.send(l).is_err() {
                            break;
                        }
                    }
                    _ => continue,
                }
            }
        });
    }
    let stderr_tail = Arc::new(Mutex::new(Vec::<String>::new()));
    if let Some(stderr) = child.stderr.take() {
        let tail = stderr_tail.clone();
        std::thread::spawn(move || {
            let mut lines: Vec<String> = BufReader::new(stderr)
                .lines()
                .map_while(Result::ok)
                .filter(|l| !l.trim().is_empty())
                .collect();
            if lines.len() > STDERR_TAIL {
                lines.drain(..lines.len() - STDERR_TAIL);
            }
            *tail.lock() = lines;
        });
    }

    let outcome = drive(&rx, stdin.as_ref(), deadline);
    kill_tree(&mut child); // 一次性探活:成功失败都收尸(已退出 = no-op)
    let _ = child.wait();

    match outcome {
        Ok((name, version, tools)) => McpProbeResult {
            ok: true,
            server_name: name,
            server_version: version,
            tools_count: Some(tools),
            error: None,
        },
        Err(message) => {
            /* 给 stderr 收割线程一拍到 EOF(进程已死管道即关)。 */
            std::thread::sleep(Duration::from_millis(120));
            let tail = stderr_tail.lock().clone();
            fail(message, Some(tail))
        }
    }
}

/** 等待目标 id 的 JSON-RPC 应答:Ok = result 应答;Err 分服务端错误
 *  (可触发版本回退)与致命错误(超时/断管/噪声超限,直接终止)。 */
enum WaitOutcome {
    Result(serde_json::Value),
    ServerError(String),
    Fatal(String),
}

fn wait_response(rx: &Receiver<String>, deadline: Instant, want_id: i64) -> WaitOutcome {
    let mut skipped = 0;
    loop {
        let Some(remain) = deadline.checked_duration_since(Instant::now()) else {
            return WaitOutcome::Fatal("超时(无应答)".to_string());
        };
        match rx.recv_timeout(remain) {
            Ok(line) => {
                let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                    skipped += 1;
                    if skipped > MAX_SKIPPED_LINES {
                        return WaitOutcome::Fatal("stdout 噪声过多".to_string());
                    }
                    continue;
                };
                if v.get("id").and_then(|i| i.as_i64()) == Some(want_id) {
                    if v.get("result").is_some() {
                        return WaitOutcome::Result(v);
                    }
                    let msg = v
                        .pointer("/error/message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("未知错误")
                        .to_string();
                    return WaitOutcome::ServerError(msg);
                }
                /* 其他 id / 单边通知:跳过 */
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                return WaitOutcome::Fatal("超时(无应答)".to_string())
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return WaitOutcome::Fatal("进程提前退出".to_string())
            }
        }
    }
}

fn write_line(stdin: Option<&ChildStdin>, payload: &serde_json::Value) -> Result<(), String> {
    let Some(mut sink) = stdin else {
        return Err("无 stdin".to_string());
    };
    let mut text = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    text.push('\n');
    sink.write_all(text.as_bytes())
        .map_err(|e| format!("写入失败(进程已退出?): {e}"))
}

/** 驱动一次完整握手:initialize(版本回退)→ initialized 通知 → tools/list。 */
fn drive(
    rx: &Receiver<String>,
    stdin: Option<&ChildStdin>,
    deadline: Instant,
) -> Result<(Option<String>, Option<String>, usize), String> {
    let mut init: Option<serde_json::Value> = None;
    for version in PROTOCOL_VERSIONS {
        let request = serde_json::json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": version, "capabilities": {},
                "clientInfo": { "name": "tmd-cli", "version": "0.1" },
            },
        });
        write_line(stdin, &request)?;
        match wait_response(rx, deadline, 1) {
            WaitOutcome::Result(v) => {
                init = Some(v);
                break;
            }
            WaitOutcome::ServerError(msg) if version != PROTOCOL_VERSIONS[2] => continue,
            WaitOutcome::ServerError(msg) => return Err(format!("initialize 被拒: {msg}")),
            WaitOutcome::Fatal(msg) => return Err(msg),
        }
    }
    let init = init.ok_or_else(|| "initialize 未完成".to_string())?;

    write_line(
        stdin,
        &serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
    )?;
    write_line(
        stdin,
        &serde_json::json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
    )?;
    let tools = match wait_response(rx, deadline, 2) {
        WaitOutcome::Result(v) => v,
        WaitOutcome::ServerError(msg) => return Err(format!("tools/list 被拒: {msg}")),
        WaitOutcome::Fatal(msg) => return Err(msg),
    };

    let name = init
        .pointer("/result/serverInfo/name")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let version = init
        .pointer("/result/serverInfo/version")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let count = tools
        .pointer("/result/tools")
        .and_then(|v| v.as_array())
        .map_or(0, Vec::len);
    Ok((name, version, count))
}

#[cfg(test)]
#[path = "mcp_probe_tests.rs"]
mod tests;
