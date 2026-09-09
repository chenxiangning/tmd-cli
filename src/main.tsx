/**
 * 入口：装配内核 + 激活插件 + 注册默认贡献 + 挂外壳。
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { IconContext } from "@phosphor-icons/react";
import { AppShell } from "@shell/AppShell";
import { HintProvider } from "@kernel/Tooltip";
import { registerDefaultContributions } from "@shell/contributions";
import { host } from "@kernel/host";
import { bootAskSound } from "@kernel/askSound";
import { bootAskRestore } from "@kernel/askWatchRestore";
import { bootTurnSound } from "@kernel/turnSound";
import { bootDropGuard } from "@kernel/dropGuard";
import { bootSessionTabs } from "@kernel/sessionTabs";
import { startThemeEngine } from "@kernel/theme";
import { bootI18n, t } from "@kernel/i18n";
import { useSettingsState } from "@kernel/settings";
import { bootUiFontSize } from "@kernel/uiFontSize";
import { bootUiZoom } from "@kernel/uiZoom";
import { bootIconDecor } from "@kernel/iconDecor";
import { allPlugins } from "@plugins/index";
import { installPluginShims } from "@kernel/pluginSdk";
import { bootLocalPlugins, activateBootLocals } from "@kernel/localPlugins";
import "./styles/global.css";

function App() {
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    startThemeEngine(); /* 设置加载 + 主题应用,与插件激活并行 */
    bootI18n(); /* 语言内核:<html lang> 同步;整树重挂载在下方 key 实现 */
    bootUiZoom(); /* 界面缩放:settings.uiZoom → webview 整页 zoom */
    bootUiFontSize(); /* 界面字号:settings.uiFontSize → html 根字号(rem 文字缩放) */
    bootIconDecor(); /* 图标装饰:settings.iconDecor → html CSS 变量 + data-icon-blink */
    bootAskSound(host.events); /* Ask 提示音:消费 askDetected(host 主链路检测,见 askWatch.ts) */
    bootTurnSound(host.events); /* 轮次结束提示音:消费 turnSettled,延迟确认后播放 */
    bootDropGuard(); /* 文件拖放护栏:防 webview drop 导航开文件(lib.rs 关原生拦截的副作用) */
    bootSessionTabs(host.events); /* 会话标题 tab 条:订阅打开/存活广播,见 kernel/sessionTabs.ts */
    const syncFocus = () => host.setWindowFocus(document.hasFocus());
    window.addEventListener("focus", syncFocus);
    window.addEventListener("blur", syncFocus);
    syncFocus();
    installPluginShims(); /* 本地插件 shim 实例表:任何外部 bundle import 之前必须就位 */
    /* 本地插件扫描与内置激活并行(内置激活时序零变化);扫描完成后在 setReady 之后晚激活,
       单插件 activate 卡死不再阻塞首屏。 */
    const localPromise = bootLocalPlugins(new Set(allPlugins.map((p) => p.id)));
    host
      .activateAll(allPlugins)
      .then(() => {
        registerDefaultContributions(host);
        setReady(true);
        bootAskRestore(); /* Ask 等待状态开机恢复(profiles 就绪后才有 askMarks,见 kernel/askWatchRestore.ts) */
        return localPromise;
      })
      .then(async (locals) => {
        /* 拓扑晚激活 + 单插件失败隔离全在 activateBootLocals;任何意外不得翻成全局错误页。 */
        try {
          await activateBootLocals(locals);
        } catch (e) {
          console.error("[local-plugins] 晚激活异常(已隔离):", e);
        }
      })
      .catch((e: unknown) => setError(String(e)));
    return () => {
      window.removeEventListener("focus", syncFocus);
      window.removeEventListener("blur", syncFocus);
    };
  }, []);

  /* 语言切换 = 整树重挂载(低频;host/PTY 态在 React 外,幕布回放按重挂载设计)。 */
  const language = useSettingsState().settings.language;
  if (error) {
    return <div className="p-4 text-red-400">{t("插件激活失败：{error}", { error })}</div>;
  }
  if (!ready) return null;
  return <AppShell key={language} />;
}

/* Phosphor 全局默认 weight=bold —— 圆胖粗线视觉(对齐"圆乎乎 icon"诉求);
 * 调用点显式 weight 可覆盖。 */
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <IconContext.Provider value={{ weight: "bold" }}>
      <HintProvider>
        <App />
      </HintProvider>
    </IconContext.Provider>
  </React.StrictMode>,
);

