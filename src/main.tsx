/**
 * 入口：装配内核 + 激活插件 + 注册默认贡献 + 挂外壳。
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { AppShell } from "@shell/AppShell";
import { registerDefaultContributions } from "@shell/contributions";
import { host } from "@kernel/host";
import { bootAskSound } from "@kernel/askSound";
import { bootTurnSound } from "@kernel/turnSound";
import { bootDropGuard } from "@kernel/dropGuard";
import { startThemeEngine } from "@kernel/theme";
import { allPlugins } from "@plugins/index";
import "./styles/global.css";

function App() {
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    startThemeEngine(); /* 设置加载 + 主题应用,与插件激活并行 */
    bootAskSound(host.events); /* Ask 提示音:消费 askDetected(host 主链路检测,见 askWatch.ts) */
    bootTurnSound(host.events); /* 轮次结束提示音:消费 turnSettled,延迟确认后播放 */
    bootDropGuard(); /* 文件拖放护栏:防 webview drop 导航开文件(lib.rs 关原生拦截的副作用) */
    /* 窗口聚焦态馈入内核:失焦时激活会话的完成也计未读(后台提醒),重聚焦即已读 */
    const syncFocus = () => host.setWindowFocus(document.hasFocus());
    window.addEventListener("focus", syncFocus);
    window.addEventListener("blur", syncFocus);
    syncFocus();
    host
      .activateAll(allPlugins)
      .then(() => {
        registerDefaultContributions(host);
        setReady(true);
      })
      .catch((e: unknown) => setError(String(e)));
    return () => {
      window.removeEventListener("focus", syncFocus);
      window.removeEventListener("blur", syncFocus);
    };
  }, []);

  if (error) {
    return <div className="p-4 text-red-400">插件激活失败：{error}</div>;
  }
  if (!ready) return null;
  return <AppShell />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
