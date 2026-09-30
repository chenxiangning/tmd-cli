//! 应用装配 —— panic 落盘钩子与主窗口构建(自 lib.rs 拆出,文件规模铁则)。
//! lib.rs 保留模块声明、AppState、杂项命令与 invoke_handler 注册表。

use tauri::webview::WebviewWindowBuilder;
use tauri::Manager;

use crate::{now_millis, session, ssh, AppState};

/// 后台任务安全打印:stderr 写失败(断管道/无读者)只忽略不 panic。
/// eprintln! 在写失败时 panic,agent/桥类长活任务里等于埋雷
/// (panic 钩子再写 stderr 则二次 panic → abort)。新代码一律用本助手。
pub(crate) fn safe_eprintln(msg: &str) {
    use std::io::Write;
    let mut err = std::io::stderr().lock();
    let _ = writeln!(err, "{msg}");
    let _ = err.flush();
}

/// panic 落盘钩子:消息/位置/线程追加到 `~/.tmd-cli/panic.log`(上限 1MB 截断)。
///
/// 背景(2026-09-03 崩溃归因):wry WKURLSchemeHandler 竞态 panic 发生在 tokio
/// 任务里,GUI 进程 stderr 无处可看、release 又 strip,崩溃只剩一份无符号 .ips。
/// unwind 语义下任务 panic 被 tokio 捕获不至于灭进程,这里再把首条现场写盘,
/// 让下一次异常可以直接对到 crate 源码行,不再依赖"同源码重构建比对偏移"。
pub(crate) fn install_panic_logger() {
    let log_path = session::config_dir().join("panic.log");
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let thread_name = thread.name().unwrap_or("<unnamed>").to_string();
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "<unknown>".to_string());
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "<non-string panic payload>".to_string());
        let line = format!(
            "[{}] thread '{thread_name}' panicked at {location}: {payload}\n",
            now_millis()
        );
        /* 钩子绝不允许再 panic:stderr 断管道(终端关闭后 app 转后台孤儿)
         * 时 eprint! 自身会 panic → 双重 panic → abort(2026-09-26 SIGABRT
         * 实证,栈底 relay_agent eprintln)。一律错误忽略直写。 */
        {
            use std::io::Write;
            let mut err = std::io::stderr().lock();
            let _ = err.write_all(line.as_bytes());
            let _ = err.flush();
        }
        if let Some(parent) = log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        // 上限保护:超 1MB 先清空,防长期运行撑爆磁盘(panic 应是罕见事件)。
        if let Ok(meta) = std::fs::metadata(&log_path) {
            if meta.len() > 1024 * 1024 {
                let _ = std::fs::write(&log_path, "");
            }
        }
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()));
    }));
}

/// setup 钩子:SSH 引擎全局注入 + 主窗口构建(平台差异化装饰)。
pub(crate) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    /* SSH 引擎全局注入(forward/sftp 后台任务的注册表回取)。 */
    {
        let state = app.state::<AppState>();
        ssh::attach_globals(Some(app.handle()), &state.ssh);
    }
    /* mut 仅为 win/mac 的窗口重赋值(下方 cfg 块)预留;linux 无重赋值,
    新工具链在其目标上报 unused_mut,精准豁免。 */
    #[cfg_attr(target_os = "linux", allow(unused_mut))]
    let mut window =
        WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
            /* 禁用 Tauri 原生 drop handler —— 让 HTML5 drop event 在 webview 内正常派发
            否则 Tauri 拦截文件拖放,只发 tauri://drag-drop 事件,composer 收不到 */
            .disable_drag_drop_handler()
            .title("tmd-cli")
            .inner_size(1440.0, 900.0)
            .min_inner_size(960.0, 600.0);

    #[cfg(target_os = "windows")]
    {
        window = window.decorations(false);
    }

    #[cfg(target_os = "macos")]
    {
        window = window
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }

    /* 渲染健康:获焦即戳前端 rAF 探针(粘死检出兜底;见 render_health.rs)。 */
    let built = window.build()?;
    let w_for_hook = built.clone();
    built.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(true) = event {
            crate::render_health::on_focused(&w_for_hook);
        }
    });
    /* 壳侧心跳守望:传感器移出 webview,「可见但久无音讯」由 Rust 独立判定进击
     * (吊销深冻时页内自报线与 Focused 事件双双失灵的兜底;见 render_health.rs)。 */
    crate::render_health::init_watchdog(built.clone());
    Ok(())
}
