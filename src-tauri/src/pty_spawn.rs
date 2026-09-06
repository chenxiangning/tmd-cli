//! PTY 会话创建与输出泵 —— openpty/命令构建/日志装配/reader-emitter 两线程转发。
//! 自 pty.rs 拆出(文件规模铁则);注册表、写入/resize/kill 与 id 原语留在 pty.rs。
//! 泵职责:PTY 字节 → 8ms 聚合窗 → 会话日志落盘 → pty://out 事件 → 退出自清理。

use std::fs::OpenOptions;
use std::io::Read;
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter, Manager};

use crate::pty::{PtyHandle, PtyRegistry, SpawnSpec, SpawnedSession};
use crate::resolve::{enriched_path, resolve_command};
use crate::session_log::{append_log, session_log_path, LogMeta};

/// 增量 UTF-8 解码：不完整的多字节尾部暂存进 `tail`，与下一 chunk 拼接后再解码。
/// 真正的坏字节(error_len 存在)按 U+FFFD 替换；仅是"没读完"的字节绝不误伤。
fn decode_utf8_chunk(tail: &mut Vec<u8>, chunk: &[u8]) -> String {
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
fn flush_utf8_tail(tail: &mut [u8]) -> Option<String> {
    if tail.is_empty() {
        return None;
    }
    Some(String::from_utf8_lossy(tail).into_owned())
}

/// 输出聚合窗:首个 chunk 到达后再收 8ms 内的后续 chunk,拼成一个事件发出。
/// 8KB/次的 read 在高吞吐场景(编译刷屏、cat 大文件)会打成事件风暴,
/// Tauri IPC 序列化 + WebView 派发是主线程开销大头;8ms ≈ 半个 60fps 帧,
/// 人眼无感,事件数可降一个数量级。
const OUT_AGGREGATE_WINDOW: Duration = Duration::from_millis(8);
/// 单次聚合批次的字节上限:防恶意/失控输出在窗口内无限堆积撑爆内存。
const OUT_AGGREGATE_MAX_BYTES: usize = 1024 * 1024;
/// ConPTY 启动握手(仅 Windows):portable-pty 0.9 以 PSEUDOCONSOLE_INHERIT_CURSOR
/// 建 pseudoconsole,ConPTY 会在输出侧发 DSR(ESC[6n)并扣住输出等 CPR 应答;
/// 此刻 xterm 尚未接入(启动期 emit 无人监听,前端输入闸也会丢弃 CPR),必须在
/// spawn 侧直接代答一次,否则终端永久黑屏(2026-09-06 win 新装机实证)。
/// 非 Windows 无此握手,主动写入会向 shell 注入垃圾字节,必须 cfg 门控。
#[cfg(windows)]
fn conpty_cpr_reply(writer: &mut dyn std::io::Write) -> std::io::Result<()> {
    writer.write_all(b"\x1b[1;1R")?;
    writer.flush()
}

pub(crate) fn spawn(
    registry: &PtyRegistry,
    app: &AppHandle,
    profile_id: &str,
    spec: SpawnSpec,
) -> Result<SpawnedSession, String> {
    let id = crate::pty::uuid_v4();
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: spec.rows,
            cols: spec.cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty 失败: {e}"))?;

    /* 注入完整 PATH:命令解析与 CLI 孙进程(git/node 等)都依赖它 */
    let path = enriched_path();
    let resolved = resolve_command(&spec.command, &path);
    let mut cmd = CommandBuilder::new(&resolved.program);
    /* Windows 批处理 shim 的 cmd /c 前插参数,unix 为空 */
    cmd.args(&resolved.prefix_args);
    cmd.args(&spec.args);
    cmd.cwd(&spec.cwd);
    cmd.env("PATH", path);
    // 全屏 TUI 依赖 TERM;Finder/Dock 启动的 .app(launchd 环境)与 Windows ConPTY 默认无 TERM,
    // 缺失时 omp/pi/codex 退化为 dumb terminal 渲染。先给默认值,spec.env 可覆盖。
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    for (k, v) in &spec.env {
        cmd.env(k, v);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn `{}` 失败: {e}", spec.command))?;
    let pid = child.process_id();

    /* 会话输出日志:~/.tmd-cli/session/<引擎>/<项目-slug>/<id>.log。
    创建失败不阻塞终端,仅关闭"加载更早输出"能力 */
    let log_path = session_log_path(profile_id, &spec.cwd, &id);
    let log_file = log_path
        .parent()
        .and_then(|dir| std::fs::create_dir_all(dir).ok())
        .and_then(|_| {
            OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&log_path)
                .ok()
        });
    let log_path = log_file.as_ref().map(|_| log_path);
    if let Some(path) = log_path.as_ref() {
        registry.logs.lock().insert(
            id.clone(),
            LogMeta {
                written: 0,
                base: 0,
                path: path.clone(),
            },
        );
    }

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader 失败: {e}"))?;
    let mut writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer 失败: {e}"))?;
    #[cfg(windows)]
    conpty_cpr_reply(&mut *writer).map_err(|e| format!("conpty CPR 应答失败: {e}"))?;
    /* 输出泵：PTY → Tauri event + 会话日志。xterm.js 只认事件通道。
    聚合选型:portable-pty 的 reader 只有阻塞 read(无 try_read),
    最小侵入方案是拆 channel 两段 ——
    reader 线程只管阻塞读 + send 原始字节(职责单一,永不阻塞下游);
    emitter 线程 recv 首 chunk 后在 8ms 窗口内 drain 尽所有后续 chunk,
    拼成一批再落日志/解码/emit。日志按批次追加(字节序不变,
    read_history_page 的偏移语义不受影响)。 */
    let out_id = id.clone();
    let out_app = app.clone();
    let logs = Arc::clone(&registry.logs);
    let out_sessions = Arc::clone(&registry.sessions);
    /* 有界 channel:队列满则 reader 阻塞 → 内核 PTY 缓冲回压子进程,
    防持续高速输出(cat 大文件/构建刷屏)下无界队列内存膨胀。 */
    let (out_tx, out_rx) = mpsc::sync_channel::<Vec<u8>>(64);
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                /* 下游已退出(前端销毁/会话结束)即停 */
                Ok(n) => {
                    if out_tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        /* drop(out_tx) 随线程结束自动发生 → emitter 收 Disconnected 退出 */
    });
    std::thread::spawn(move || {
        let event = format!("pty://out/{out_id}");
        /* 跨 chunk 的不完整 UTF-8 尾部(如 3 字节中文被聚合批边界劈开),
        暂存后与下一批拼接再解码,避免 from_utf8_lossy 逐包转换产生 */
        let mut tail: Vec<u8> = Vec::new();
        let mut log_file = log_file;
        /* 阻塞等首 chunk;channel 关闭且排空 → 会话结束 */
        while let Ok(first) = out_rx.recv() {
            let mut batch = first;
            /* 聚合窗:drain 窗口内已到达的所有 chunk,合并为一个事件 */
            let deadline = Instant::now() + OUT_AGGREGATE_WINDOW;
            while batch.len() < OUT_AGGREGATE_MAX_BYTES {
                let now = Instant::now();
                if now >= deadline {
                    break;
                }
                match out_rx.recv_timeout(deadline - now) {
                    Ok(chunk) => batch.extend_from_slice(&chunk),
                    /* Timeout → 窗口耗尽;Disconnected → 先发完手头这批,
                    下一轮 recv 拿到 Err 再统一走退出清理 */
                    Err(_) => break,
                }
            }
            /* 原始字节先落日志(供幕布往前翻页),再解码推事件 */
            if let (Some(file), Some(path)) = (log_file.as_mut(), log_path.as_ref()) {
                if append_log(&logs, &out_id, file, path, &batch).is_err() {
                    log_file = None; // 日志失败不拖累终端;翻页能力降级
                }
            }
            let text = decode_utf8_chunk(&mut tail, &batch);
            if out_app.emit(&event, text).is_err() {
                break; // 前端已销毁
            }
        }
        /* 泵循环结束仍残留的 tail = 不完整 UTF-8 序列(进程最后输出的半个字符),
        永远等不到后续字节 —— 按 U+FFFD 替换补发,不静默吞掉 */
        if let Some(text) = flush_utf8_tail(&mut tail) {
            let _ = out_app.emit(&event, text);
        }
        /* 进程退出即会话销毁:清理日志文件与账本(kill 路径同样经由此处) */
        if let Some(path) = log_path.as_ref() {
            let _ = std::fs::remove_file(path);
        }
        logs.lock().remove(&out_id);
        /* Rust 侧自清理:移除句柄并回收子进程,不依赖前端 kill 回调 ——
         * webview reload 会错过 pty://exit,句柄(master fd)否则永久滞留。 */
        if let Some(mut handle) = out_sessions.lock().remove(&out_id) {
            let _ = handle.child.kill();
        }
        /* 活会话注册表同步移除:webview reload 错过 exit 事件后,
         * session_list 不再把死会话当活会话返回 */
        if let Some(state) = out_app.try_state::<crate::AppState>() {
            state.sessions.remove(&out_id);
        }
        let _ = out_app.emit(&format!("pty://exit/{out_id}"), ());
    });

    registry.sessions.lock().insert(
        id.clone(),
        PtyHandle {
            writer: Arc::new(Mutex::new(writer)),
            master: pair.master,
            child,
            size: Mutex::new((spec.cols, spec.rows)),
        },
    );

    Ok(SpawnedSession { id, pid })
}

#[cfg(test)]
#[path = "pty_spawn_tests.rs"]
mod tests;
