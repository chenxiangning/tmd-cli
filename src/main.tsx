/**
 * 入口：装配内核 + 激活插件 + 注册默认贡献 + 挂外壳。
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { AppShell } from "@shell/AppShell";
import { registerDefaultContributions } from "@shell/contributions";
import { host } from "@kernel/host";
import { bootAskSound } from "@kernel/askSound";
import { startThemeEngine } from "@kernel/theme";
import { allPlugins } from "@plugins/index";
import "./styles/global.css";

function App() {
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    startThemeEngine(); /* 设置加载 + 主题应用,与插件激活并行 */
    bootAskSound(host.events); /* Ask 提示音观察者:先于插件激活,不漏任何会话输出 */
    host
      .activateAll(allPlugins)
      .then(() => {
        registerDefaultContributions(host);
        setReady(true);
      })
      .catch((e: unknown) => setError(String(e)));
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
