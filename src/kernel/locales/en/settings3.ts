/** en 词典 · settings 域第三段(2026-10-26 拆:settings.ts 触 300 行铁则)。 */
export const MESSAGES = {
  "我已了解并自行承担风险": "I understand the risks and accept them",
  "有浏览器客户端正通过 Web 访问控制本机":
    "A browser client is controlling this machine via web access",
  "会话输出日志保留": "Session log retention",
  "应用异常退出会残留会话输出日志;超过保留天数的旧日志在启动时自动清理,使用中的会话不受影响。":
    "Abnormal exits can leave session logs behind; logs older than the retention window are cleaned at startup. Active sessions are never touched.",
  "30 天": "30 days",
  "90 天": "90 days",
  "不清理": "Never",
  "终端 WebGL 渲染": "Terminal WebGL rendering",
  "实验:GPU 加速终端渲染,异常时自动回退内置渲染器;HTop/vim 等全屏重绘更流畅。默认关闭。": 
    "Experimental: GPU-accelerated terminal rendering that falls back to the built-in renderer automatically on failure; smoother full-screen redraws in HTop/vim. Off by default.",
  "渲染健康诊断": "Render health diagnostics",
  "本运行期无渲染异常记录。": "No render anomalies this run.",
  "最近事件(新→旧):": "Recent events (new → old):",
} as Record<string, string>;
