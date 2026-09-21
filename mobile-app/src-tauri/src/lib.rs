//! tmd-cli mobile 壳:Rust 侧零业务命令(桌面命令面不镜像 —— invoke 全部经
//! kernel/transport 的远程模式直达桌面桥)。壳只负责:
//! 1. 造带 initialization_script 标记的 webview(前端据此进配对屏/远程模式);
//! 2. (M2)本地通知、钥匙串凭证。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default().setup(|app| {
        #[cfg(mobile)]
        {
            use tauri::Manager;
            tauri::WebviewWindowBuilder::new(
                app,
                "mobile",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("tmd-cli")
            .initialization_script("window.__TMD_SHELL__ = 'mobile';")
            .build()?;
            let _ = app.get_webview_window("mobile");
        }
        Ok(())
    })
    .run(tauri::generate_context!())
    .expect("tmd-cli mobile 壳启动失败");
}
