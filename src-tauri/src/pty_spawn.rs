//! PTY 会话创建与输出泵 —— openpty/命令构建/日志装配/reader-emitter 两线程转发。
//! 自 pty.rs 拆出(文件规模铁则);注册表、写入/resize/kill 与 id 原语留在 pty.rs。
//! 泵职责:PTY 字节 → 自适应聚合窗 → 会话日志落盘 → pty://out 事件 → 退出自清理。

use std::fs::OpenOptions;
use std::io::Read;
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Manager};

use crate::pty::{PtyHandle, PtyRegistry, SpawnSpec, SpawnedSession};
use crate::resolve::{enriched_path, resolve_command};
use crate::session_log::{append_log, session_log_path, LogMeta};

/// 增量 UTF-8 解码(实现见 pty_decode.rs;再导出保 ssh/io.rs 引用不变)。
#[path = "pty_decode.rs"]
pub(crate) mod pty_decode;
pub(crate) use pty_decode::{decode_utf8_chunk, flush_utf8_tail};

/// 输出聚合窗:首 chunk 后再收 8ms 内的后续 chunk 拼成一个事件。8KB/次的
/// read 在高吞吐下会打成事件风暴,IPC 序列化 + WebView 派发是主线程开销大头。
const OUT_AGGREGATE_WINDOW: Duration = Duration::from_millis(8);
/// 自适应长窗上限:持续洪峰时窗长逐批翻倍至此。50ms = TUI 整帧 20fps 量级,
/// 观感无差;事件数再降数倍(2026-09-30 并发工作期前端饱和卡死取证)。
const OUT_AGGREGATE_WINDOW_MAX: Duration = Duration::from_millis(50);
/// 后台慢拍窗:无激活幕布(viewed)或前端渲染暂停时聚合窗钳到此。omp 等 TUI
/// 状态动画以 15-20tick/s 整帧重绘持续数十分钟(实测 55MB/9min),每事件都过
/// IPC + 全守望链 + 双份 xterm 解析 —— 无人观看照单全收即主线程饱和底噪,正是
/// WKWebView 吊销粘死(幕布假死)的触发土壤(2026-10-04 十一轮)。250ms 与
/// 隐藏幕布合帧/镜像采样同拍:Ask/呼吸灯时延不变、字节零丢弃;激活幕布零改动。
const OUT_BACKGROUND_WINDOW: Duration = Duration::from_millis(250);
/// 单次聚合批次的字节上限:防恶意/失控输出在窗口内无限堆积撑爆内存。
const OUT_AGGREGATE_MAX_BYTES: usize = 1024 * 1024;

/// 自适应窗推进(纯函数,测试锚):批排到窗口耗尽/批满 = 生产者仍在前进,
/// 窗长翻倍封顶;孤立小块(≤256B,击键回显/单 tick)回基线不吃长窗延迟;其余保持。
fn next_aggregate_window(window: Duration, saturated: bool, batch_len: usize) -> Duration {
    if saturated {
        (window * 2).min(OUT_AGGREGATE_WINDOW_MAX)
    } else if batch_len <= 256 {
        OUT_AGGREGATE_WINDOW
    } else {
        window
    }
}

/// 有效聚合窗(测试锚):前台(激活幕布+渲染活跃)保持自适应窗,后台钳到慢拍。
/// 窗长只影响事件节拍,批次字节内容与日志保真不受触碰。
fn effective_window(window: Duration, foreground: bool) -> Duration {
    if foreground {
        window
    } else {
        window.max(OUT_BACKGROUND_WINDOW)
    }
}
/// ConPTY 启动握手(仅 Windows):ConPTY 输出侧发 DSR 并扣住输出等 CPR 应答,
/// xterm 尚未接入(启动期 emit 无人监听,输入闸也丢弃 CPR),必须在 spawn 侧
/// 代答一次,否则永久黑屏(2026-09-06 实证)。非 Windows 必须 cfg 门控。
#[cfg(windows)]
fn conpty_cpr_reply(writer: &mut dyn std::io::Write) -> std::io::Result<()> {
    writer.write_all(b"\x1b[1;1R")?;
    writer.flush()
}

/// 退出码归一(收割单点):Windows NTSTATUS 以 u32 上行,`as i32` 后
/// STATUS_CONTROL_C_EXIT(0xC000013A = 3221225786)变负大数,穿透前端
/// 「0/130 不扰」白名单,幕布 Ctrl+C 未处理路径误弹「会话异常退出」
/// (2026-09-28 评审)。与 Unix SIGINT(130)同义归一,两端共用同一契约;
/// 其余崩溃码保持原值如实展示。
#[cfg(windows)]
fn normalize_exit_code(code: u32) -> i32 {
    if code == 0xC000_013A {
        130
    } else {
        code as i32
    }
}

#[cfg(not(windows))]
fn normalize_exit_code(code: u32) -> i32 {
    code as i32
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

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader 失败: {e}"))?;
    /* mut 仅 Windows ConPTY CPR 应答(下方 cfg(windows))用;非 Windows 构建
    writer 只读移交 PtyHandle 的 Mutex,mut 成假需求 —— 按目标平台消警。 */
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer 失败: {e}"))?;
    #[cfg(windows)]
    conpty_cpr_reply(&mut *writer).map_err(|e| format!("conpty CPR 应答失败: {e}"))?;
    /* 会话输出日志:~/.tmd-cli/session/<引擎>/<项目-slug>/<id>.log;创建与插表压后到
    reader/writer 双获取之后(2026-10-04 评审)—— emitter 线程是唯一清理点,提前
    返回不留孤儿文件/账本条目;创建失败仅关"加载更早输出"能力。 */
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
    /* 先插注册表再起泵线程:子进程秒退时 emitter 的退出清理(remove)必须能
    找到它,否则死亡 handle 永久滞留 sessions 表(master fd 泄漏)。 */
    registry.sessions.lock().insert(
        id.clone(),
        PtyHandle {
            writer: Arc::new(Mutex::new(writer)),
            master: pair.master,
            child,
            size: Mutex::new((spec.cols, spec.rows)),
            viewed: std::sync::atomic::AtomicBool::new(false),
        },
    );
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
        /* 自适应窗:8ms 基线;批内排到窗口耗尽/批满 = 生产者仍在前进,下一批
        窗长翻倍(封顶 50ms);孤立小块(击键回显/单 tick 更新)回基线。 */
        let mut window = OUT_AGGREGATE_WINDOW;
        /* 阻塞等首 chunk;channel 关闭且排空 → 会话结束 */
        while let Ok(first) = out_rx.recv() {
            let mut batch = first;
            /* 前台判据:激活幕布在视 + 前端渲染活跃(窗口隐藏/遮挡吊销期
            rAF 停跳,webview 不再消费渲染 —— 快拍只喂饱和,降慢拍)。 */
            let foreground = crate::render_health::render_active()
                && out_sessions
                    .lock()
                    .get(&out_id)
                    .map(|h| h.viewed.load(std::sync::atomic::Ordering::Relaxed))
                    .unwrap_or(false);
            /* 聚合窗:drain 窗口内已到达的所有 chunk,合并为一个事件 */
            let mut saturated = false;
            let deadline = Instant::now() + effective_window(window, foreground);
            while batch.len() < OUT_AGGREGATE_MAX_BYTES {
                let now = Instant::now();
                if now >= deadline {
                    saturated = true;
                    break;
                }
                match out_rx.recv_timeout(deadline - now) {
                    Ok(chunk) => batch.extend_from_slice(&chunk),
                    /* Timeout → 窗口耗尽;Disconnected → 先发完手头这批,
                    下一轮 recv 拿到 Err 再统一走退出清理 */
                    Err(_) => break,
                }
            }
            window = next_aggregate_window(window, saturated, batch.len());
            /* 原始字节先落日志(供幕布往前翻页),再解码推事件 */
            if let (Some(file), Some(path)) = (log_file.as_mut(), log_path.as_ref()) {
                if append_log(&logs, &out_id, file, path, &batch).is_err() {
                    log_file = None; // 日志失败不拖累终端;翻页能力降级
                }
            }
            let text = decode_utf8_chunk(&mut tail, &batch);
            crate::render_health::note_pty_emitted(text.len());
            if !crate::event_sink::emit(&out_app, &event, &text) {
                break; // 前端已销毁
            }
        }
        /* 泵循环结束仍残留的 tail = 不完整 UTF-8 序列(进程最后输出的半个字符),
        永远等不到后续字节 —— 按 U+FFFD 替换补发,不静默吞掉 */
        if let Some(text) = flush_utf8_tail(&mut tail) {
            let _ = crate::event_sink::emit(&out_app, &event, &text);
        }
        /* 进程退出即会话销毁:清理日志文件与账本(kill 路径同样经由此处) */
        if let Some(path) = log_path.as_ref() {
            let _ = std::fs::remove_file(path);
        }
        logs.lock().remove(&out_id);
        /* 活会话注册表同步移除:webview reload 错过 exit 事件后,
         * session_list 不再把死会话当活会话返回。单一 remove 点:kill 收尸与
         * 真实退出码采集同处完成(此前两连 remove 把码吞成恒 null,P0 回归)。
         * session_kill → pty.rs 已先 remove 同一 map,此处拿 None = 用户 kill,
         * code null → 前端「未知不扰」;自然退出/崩溃则拿到真实码。 */
        let mut code: Option<i32> = None;
        if let Some(mut handle) = out_sessions.lock().remove(&out_id) {
            let _ = handle.child.kill();
            /* 收尸拿真实退出码(kill 后 wait 的收尸语义不变)。
             * 信号死亡 portable-pty 归一 exit_code=1(信号名在 signal(),另发不采)。 */
            code = handle
                .child
                .wait()
                .ok()
                .map(|status| normalize_exit_code(status.exit_code()));
        }
        if let Some(state) = out_app.try_state::<crate::AppState>() {
            state.sessions.remove(&out_id);
        }
        let _ = crate::event_sink::emit(
            &out_app,
            &format!("pty://exit/{out_id}"),
            &serde_json::json!({ "code": code }),
        );
    });

    Ok(SpawnedSession { id, pid })
}

#[cfg(test)]
#[path = "pty_spawn_tests.rs"]
mod tests;
