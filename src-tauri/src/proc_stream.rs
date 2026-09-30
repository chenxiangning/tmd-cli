//! 通用长驻流式子进程通道 —— 结构化会话等前端消费者 spawn 子进程后持续读写:
//! stdout/stderr 按**行**聚成 `proc://stream/{id}/out|err` 事件推前端,退出推
//! `proc://stream/{id}/exit`(经 event_sink 单源扇出,桌面 webview 与 Web 桥同收,
//! pty://out 同纪律)。内核不懂任何 CLI 协议:本模块只有「跑一个进程、按行推流、
//! 可写可杀」的通用语义;NDJSON RPC 的帧语义归前端插件侧。
//!
//! 生命周期:registry 持 child(id = proc-N 单调);两 reader 线程 EOF 后由后到者
//! wait_child_with_timeout 自然收割(超时杀树兜底,proc_run EOF 竞态同修法)再发
//! exit 并清注册表;kill 走 kill_tree(Windows npm shim 杀整树)。webview reload
//! 后前端失忆,boot 期 proc_stream_kill_all 清孤儿。
//!
//! 阻塞安全:命令体 async + 内部 std 线程;锁粒度 = registry 一把,临界区内
//! 无阻塞 IO(write 直落 stdin 管道,≤ 管道缓冲;满则写阻塞持有 stdin 锁——
//! 消费端是同进程 CLI,持续读 stdin 协议下不构成死锁面)。

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use parking_lot::Mutex;

use serde::Deserialize;
use tauri::AppHandle;

use crate::event_sink;
use crate::resolve::{
    enriched_path, hide_console, kill_tree, resolve_command, wait_child_with_timeout,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcStreamSpec {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: String,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

/// 单行上限:NDJSON 帧(RPC maxFrameBytes 量级)之外留余;超长行截断防无界缓冲。
const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;
/// 收割宽限:两管道 EOF 后等自然退出的窗口,超时杀树(对齐 proc_run 语义)。
const REAP_GRACE: Duration = Duration::from_secs(2);

struct Entry {
    child: Mutex<Child>,
    stdin: Mutex<Option<std::process::ChildStdin>>,
}

static REGISTRY: LazyLock<Mutex<HashMap<String, Arc<Entry>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static SEQ: AtomicU64 = AtomicU64::new(0);

fn event_name(id: &str, kind: &str) -> String {
    format!("proc://stream/{id}/{kind}")
}

/// spawn 并起泵;返回流 id。命令解析/PATH 增强/隐藏控制台窗与 proc_run 同律。
pub fn spawn(app: &AppHandle, spec: &ProcStreamSpec) -> Result<String, String> {
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

    let stdin = child.stdin.take();
    let streams: [(Box<dyn Read + Send>, &str); 2] = [
        (Box::new(child.stdout.take().unwrap()), "out"),
        (Box::new(child.stderr.take().unwrap()), "err"),
    ];

    let id = format!("proc-{}", SEQ.fetch_add(1, Ordering::Relaxed));
    let entry = Arc::new(Entry {
        child: Mutex::new(child),
        stdin: Mutex::new(stdin),
    });
    REGISTRY.lock().insert(id.clone(), entry.clone());
    let app_out = app.clone();
    let id_out = id.clone();

    /* 双 reader:BufRead 按行切(行内多字节 UTF-8 天然完整);后到 EOF 者收割。 */
    let pending = Arc::new(AtomicU64::new(2));
    for (stream, kind) in streams {
        let app = app_out.clone();
        let id = id_out.clone();
        let entry = entry.clone();
        let pending = pending.clone();
        std::thread::spawn(move || {
            let event = event_name(&id, kind);
            {
                let mut reader = BufReader::new(stream);
                let mut line = String::new();
                loop {
                    line.clear();
                    match read_limited_line(&mut reader, &mut line) {
                        Ok(0) => break,  // EOF
                        Ok(_) => {}      // 一行(含超限截断行)
                        Err(_) => break, // 管道错(下游亡)视同 EOF
                    }
                    if !line.is_empty() && !event_sink::emit(&app, &event, &line) {
                        break; // 前端已销毁
                    }
                }
            }
            if pending.fetch_sub(1, Ordering::AcqRel) == 1 {
                /* 后到 EOF:自然收割(宽限内不退由 helper 杀树兜底),发 exit 清注册表。 */
                let mut child = entry.child.lock();
                let code = wait_child_with_timeout(&mut child, REAP_GRACE)
                    .and_then(|s| s.ok())
                    .and_then(|s| s.code());
                *entry.stdin.lock() = None;
                REGISTRY.lock().remove(&id);
                let _ = event_sink::emit(&app, &event_name(&id, "exit"), &code);
            }
        });
    }
    Ok(id)
}

/// 写 stdin(不关管道:长驻协议靠显式命令/kill 终结,EOF 会令 RPC server 退出)。
pub fn write(id: &str, data: &str) -> Result<(), String> {
    let entry = REGISTRY
        .lock()
        .get(id)
        .cloned()
        .ok_or_else(|| format!("proc_stream {id} 不存在"))?;
    let mut guard = entry.stdin.lock();
    let pipe = guard
        .as_mut()
        .ok_or_else(|| format!("proc_stream {id} 已结束"))?;
    pipe.write_all(data.as_bytes())
        .and_then(|_| pipe.flush())
        .map_err(|e| format!("proc_stream {id} 写入失败: {e}"))
}

/// 杀进程树;exit 事件由 reader EOF 路径统一发(单一出口,码语义一致)。
pub fn kill(id: &str) {
    let entry = REGISTRY.lock().get(id).cloned();
    if let Some(entry) = entry {
        kill_tree(&mut entry.child.lock());
    }
}

/// 清全部(webview 重启后前端失忆,boot 期兜底清孤儿)。
pub fn kill_all() {
    let entries: Vec<Arc<Entry>> = REGISTRY.lock().values().cloned().collect();
    for entry in entries {
        kill_tree(&mut entry.child.lock());
    }
}

#[tauri::command]
pub(crate) async fn proc_stream_spawn(
    app: AppHandle,
    spec: ProcStreamSpec,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || spawn(&app, &spec))
        .await
        .map_err(|e| format!("proc_stream_spawn join 失败: {e}"))?
}

#[tauri::command]
pub(crate) async fn proc_stream_write(id: String, data: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write(&id, &data))
        .await
        .map_err(|e| format!("proc_stream_write join 失败: {e}"))?
}

#[tauri::command]
pub(crate) fn proc_stream_kill(id: String) {
    kill(&id);
}

#[tauri::command]
pub(crate) fn proc_stream_kill_all() {
    kill_all();
}

/// 按行读,超 MAX_LINE_BYTES 截断本行(丢弃到换行)防无界缓冲。
/// 返回读到的字节数(含换行):0 仅代表 EOF,空行返回 1 不与 EOF 混淆。
fn read_limited_line<R: BufRead>(reader: &mut R, out: &mut String) -> std::io::Result<usize> {
    let mut buf = Vec::with_capacity(512);
    let n = Read::take(&mut *reader, MAX_LINE_BYTES as u64).read_until(b'\n', &mut buf)?;
    if n == 0 {
        return Ok(0); // EOF
    }
    if buf.last() == Some(&b'\n') {
        buf.pop();
    } else if buf.len() == MAX_LINE_BYTES {
        /* 截断:吞到行尾,标省略号让消费方可感知 */
        buf.extend_from_slice("…[truncated]".as_bytes());
        let mut byte = [0u8; 1];
        loop {
            if reader.read(&mut byte)? == 0 || byte[0] == b'\n' {
                break;
            }
        }
    }
    out.push_str(&String::from_utf8_lossy(&buf));
    Ok(n)
}

#[cfg(test)]
#[path = "proc_stream_tests.rs"]
mod tests;
