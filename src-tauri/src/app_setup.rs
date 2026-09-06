//! 应用装配 —— panic 落盘钩子与主窗口构建(自 lib.rs 拆出,文件规模铁则)。
//! lib.rs 保留模块声明、AppState、杂项命令与 invoke_handler 注册表。

use tauri::webview::WebviewWindowBuilder;
use tauri::Manager;

use crate::{now_millis, session, ssh, AppState};

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
        eprint!("{line}");
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

    window.build()?;
    Ok(())
}
