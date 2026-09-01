/**
 * 入口：装配内核 + 激活插件 + 挂外壳。
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { AppShell } from "@shell/AppShell";
import { host } from "@kernel/host";
import { allPlugins } from "@plugins/index";
import "./styles/global.css";

function App() {
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    host
      .activateAll(allPlugins)
      .then(() => setReady(true))
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
