/* release 必须是 GUI 子系统:缺这行时 Windows 每次启动都拉起一个常驻控制台
 * 窗口(标题 tmd-cli),WebView2 的 stderr 诊断也全部打在那个窗口里。
 * debug 保持 console,保留 eprintln 调试通道。 */
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    tmd_cli_lib::run()
}
