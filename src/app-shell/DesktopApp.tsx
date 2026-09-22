/**
 * 桌面壳装配(动态 import 分离:手机 bundle 不含桌面树)。
 * 自 main.tsx 拆出 —— 本组件挂载即激活全部内核 boot(主题/插件/PTY 接管)。
 */
import React from "react";
import { host } from "@kernel/host";
import { bootI18n } from "@kernel/i18n";
import { startThemeEngine } from "@kernel/theme";
import { useSettingsState } from "@kernel/settings";
import { bootUiFontSize } from "@kernel/uiFontSize";
import { bootUiZoom } from "@kernel/uiZoom";
import { initUpdatePresence } from "./updatePresence";
import { bootIconDecor } from "@kernel/iconDecor";
import { allPlugins } from "@plugins/index";
import { installPluginShims } from "@kernel/pluginSdk";
import { bootLocalPlugins, activateBootLocals } from "@kernel/localPlugins";
import { AppShell } from "./AppShell";
import { bootAskSound } from "@kernel/askSound";
import { bootTurnSound } from "@kernel/turnSound";
import { bootDropGuard } from "@kernel/dropGuard";
import { bootSessionTabs } from "@kernel/sessionTabs";
import { registerDefaultContributions } from "./contributions";
import { bootAskRestore } from "@kernel/askWatchRestore";
import { t } from "@kernel/i18n";

export function DesktopApp() {
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
    initUpdatePresence(); /* 更新感应后台化:6h 节流检查,底栏版本号旁亮提示(boot 级,不随左栏关闭停摆) */
    bootSessionTabs(host.events); /* 会话标题 tab 条:订阅打开/存活广播,见 kernel/sessionTabs.ts */
    const syncFocus = () => host.setWindowFocus(document.hasFocus());
    window.addEventListener("focus", syncFocus);
    window.addEventListener("blur", syncFocus);
    syncFocus();
    installPluginShims(); /* 本地插件 shim 实例表:任何外部 bundle import 之前必须就位 */
    const localPromise = bootLocalPlugins(new Set(allPlugins.map((p) => p.id)));
    host
      .activateAll(allPlugins)
      .then(() => {
        registerDefaultContributions(host);
        setReady(true);
        void host.readoptSessions(); /* webview 重载后活 PTY 重新接管 */
        bootAskRestore();
        return localPromise.catch((e) => {
          console.error("[local-plugins] 扫描异常(已隔离):", e);
          return [];
        });
      })
      .then(async (locals) => {
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

/* overlay 挂点渲染(AppShell 内 <Mounts point="overlay" /> 消费;toasts 保持原位) */
