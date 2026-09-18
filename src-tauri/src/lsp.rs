//! LSP 通用原语 —— 长驻 stdio 语言服务器进程的 spawn/组帧/转发/收割。
//!
//! 协议知识边界:本模块只懂 Content-Length 消息组帧(字节↔消息边界),不懂
//! 任何 LSP 方法语义;JSON-RPC 关联(请求 id/超时/取消/初始化)全在前端
//! kernel/lsp/lspClient。key = 前端自定会话键(约定 `<workspaceId>:<language>`),
//! 同 key 幂等 spawn(活着直接 Ok),进程退出自动摘除,重 spawn 即重启。
//!
//! 事件(event_sink 双扇出):lsp://message {key,payload} 完整 JSON 文本、
//! lsp://stderr {key,text} 服务端日志行、lsp://exit {key,code}。
//! server 语义级关停(shutdown/exit 通知)是前端的事;lsp_stop 只管杀树
//! (kill_tree;管道随之 EOF,reader 线程自然收尾)。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, LazyLock};

use parking_lot::Mutex;
use serde::Serialize;
use tauri::AppHandle;

use crate::event_sink;
use crate::resolve::{enriched_path, hide_console, kill_tree, resolve_command};

struct LspProc {
    pid: u32,
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
}

static REGISTRY: LazyLock<Mutex<HashMap<String, LspProc>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MessageEvent<'a> {
    key: &'a str,
    payload: &'a str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TextEvent<'a> {
    key: &'a str,
    text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitEvent<'a> {
    key: &'a str,
    code: Option<i32>,
}

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

fn remove_if_same_pid(key: &str, pid: u32) {
    REGISTRY.lock().retain(|k, p| k != key || p.pid != pid);
}

/// 启动(或复用)key 对应的语言服务器进程。
pub(crate) fn spawn_lsp(
    app: &AppHandle,
    key: &str,
    command: &str,
    args: &[String],
    cwd: &str,
    env: &HashMap<String, String>,
) -> Result<(), String> {
    {
        let guard = REGISTRY.lock();
        if let Some(p) = guard.get(key) {
            let alive = p
                .child
                .lock()
                .try_wait()
                .map(|s| s.is_none())
                .unwrap_or(false);
            if alive {
                return Ok(()); // 幂等:前端重试/竞态双 spawn 直接收敛
            }
        }
    }

    let resolved = resolve_command(command, &enriched_path());
    let mut cmd = Command::new(resolved.program);
    cmd.args(resolved.prefix_args)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in env {
        cmd.env(k, v);
    }
    hide_console(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn {command} 失败: {e}"))?;
    let pid = child.id();
    let stdin = child.stdin.take().expect("lsp stdin piped");
    let mut stdout = child.stdout.take().expect("lsp stdout piped");
    let mut stderr = child.stderr.take().expect("lsp stderr piped");

    let child = Arc::new(Mutex::new(child));
    let stdin = Arc::new(Mutex::new(stdin));
    let key_owned = key.to_string();

    // reader 线程:组帧 → 事件;EOF = 进程退出/管道关闭 → 收割 reap + 摘除 + 通知。
    let child_reader = Arc::clone(&child);
    let key_reader = key_owned.clone();
    let app_reader = app.clone();
    std::thread::spawn(move || {
        let mut buf: Vec<u8> = Vec::with_capacity(16 * 1024);
        let mut chunk = [0u8; 16 * 1024];
        loop {
            match stdout.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    buf.extend_from_slice(&chunk[..n]);
                    for msg in extract_messages(&mut buf) {
                        event_sink::emit(
                            &app_reader,
                            "lsp://message",
                            &MessageEvent {
                                key: &key_reader,
                                payload: &msg,
                            },
                        );
                    }
                }
            }
        }
        // reap(僵尸回收)再发 exit;与 lsp_stop 竞态无害(按 pid 摘除)。
        let code = child_reader.lock().wait().ok().and_then(|s| s.code());
        remove_if_same_pid(&key_reader, pid);
        event_sink::emit(
            &app_reader,
            "lsp://exit",
            &ExitEvent {
                key: &key_reader,
                code,
            },
        );
    });

    // stderr 线程:服务端日志行透传(调试面;前端默认忽略)。
    let key_err = key_owned;
    let app_err = app.clone();
    std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text);
        if !text.is_empty() {
            event_sink::emit(
                &app_err,
                "lsp://stderr",
                &TextEvent {
                    key: &key_err,
                    text,
                },
            );
        }
    });

    REGISTRY.lock().insert(
        key.to_string(),
        LspProc {
            pid,
            child: Arc::clone(&child),
            stdin: Arc::clone(&stdin),
        },
    );
    Ok(())
}

/// 写入一条完整 JSON-RPC 消息(前端已组好串;此处只组帧)。
pub(crate) fn send_lsp(key: &str, message: &str) -> Result<(), String> {
    let guard = REGISTRY.lock();
    let Some(p) = guard.get(key) else {
        return Err(format!("lsp_send: 会话 {key} 不存在"));
    };
    let body = message.as_bytes();
    let mut pipe = p.stdin.lock();
    pipe.write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes())
        .and_then(|_| pipe.write_all(body))
        .and_then(|_| pipe.flush())
        .map_err(|e| format!("lsp_send 写入失败: {e}"))
}

/// 杀树收割(taskkill /T 或 unix kill;管道 EOF 后 reader 线程自行收尾)。
pub(crate) fn stop_lsp(key: &str) -> Result<(), String> {
    let Some(p) = REGISTRY.lock().remove(key) else {
        return Ok(()); // 已不在 = 幂等
    };
    kill_tree(&mut p.child.lock());
    Ok(())
}

#[tauri::command]
pub(crate) fn lsp_spawn(
    app: AppHandle,
    key: String,
    command: String,
    args: Vec<String>,
    cwd: String,
    env: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let env = env.unwrap_or_default();
    spawn_lsp(&app, &key, &command, &args, &cwd, &env)
}

#[tauri::command]
pub(crate) fn lsp_send(key: String, message: String) -> Result<(), String> {
    send_lsp(&key, &message)
}

#[tauri::command]
pub(crate) fn lsp_stop(key: String) -> Result<(), String> {
    stop_lsp(&key)
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
