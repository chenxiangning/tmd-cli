fn main() {
    tauri_build::build();

    /* cargo test 的单元测试二进制不走 tauri-build 的 WindowsResource(仅链进
     * bin 目标),缺 Common-Controls v6 manifest;而 tauri-plugin-dialog → rfd
     * 静态导入 TaskDialogIndirect(仅 SxS 的 comctl32 v6 提供),加载器绑到
     * System32 的 comctl32 v5 缺导出 → 测试进程启动即
     * STATUS_ENTRYPOINT_NOT_FOUND(0xc0000139,2026-09-06 win 新装机实证)。
     *
     * cargo 没有「仅单测二进制」的链接参数指令(rustc-link-arg-tests 只管
     * tests/ 集成测试),故对全部 msvc 目标把 comctl32 改为延迟加载:
     * - 测试进程永不调用 TaskDialogIndirect → 不触发解析,启动正常;
     * - 主程序自身带 v6 manifest,运行期首次调用时 LoadLibrary 经 SxS 照常
     *   解析到 v6,对话框行为不变。 */
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target = std::env::var("TARGET").unwrap_or_default();
    if target_os == "windows" && target.contains("msvc") {
        println!("cargo:rustc-link-arg=/DELAYLOAD:comctl32.dll");
        println!("cargo:rustc-link-arg=delayimp.lib");
    }
}
