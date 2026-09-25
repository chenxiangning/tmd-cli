/**
 * 入口:按环境分流两棵独立 UI 树。
 * - 手机壳(__TMD_SHELL__=mobile):src/mobile 独立远程 UI(不加载桌面树)。
 * - 桌面/浏览器:动态 import app-shell/DesktopApp(与手机包 chunk 分离)。
 * 共享的只有数据面:@kernel/transport(RPC/事件)与少量 kernel 原语。
 */
import "./kernel/withResolversShim"; /* 首位:垫片先于一切静态图求值 */
import React from "react";
import ReactDOM from "react-dom/client";
import { IconContext } from "@phosphor-icons/react";
import { HintProvider } from "@kernel/Tooltip";
import { isMobileShell } from "./mobile/shared";

/* Phosphor 全局默认 weight=bold —— 圆胖粗线视觉(对齐「圆乎乎 icon」诉求);
 * 调用点显式 weight 可覆盖。模块级常量:Provider value 引用稳定。
 * 2026-09-25 恢复:b2f14b2 双树分离重写入口时整块丢失,桌面/手机图标静默退回细体。 */
const ICON_CONTEXT = { weight: "bold" } as const;

/* 样式也分家(大仙 2026-09-25:app 与客户端不许混载):mobile 分支只载
 * mobile.css(自持令牌+reset,不依赖桌面 themes.css),桌面分支只载
 * global.css。CSS 动态 import 由 vite 按分支切 chunk,两树互不背对方字节。 */
const cssPromise = isMobileShell() ? import("./mobile/mobile.css") : import("./styles/global.css");

const root = ReactDOM.createRoot(document.getElementById("root")!);

if (isMobileShell()) {
  /* 双树皆动态:mobile 分支静态引 gate 会让桌面首包背上 mobile 树
   * (含 7 家 CLI 磁盘扫描器,评审 P1-2);对偶分支同构。 */
  cssPromise
    .then(() => import("./mobile/gate"))
    .then(({ MobileRoot }) => {
      root.render(
        <React.StrictMode>
          <IconContext.Provider value={ICON_CONTEXT}>
            <MobileRoot />
          </IconContext.Provider>
        </React.StrictMode>,
      );
    })
    .catch((e) => {
      root.render(<div style={{ padding: 24, color: "#c33" }}>mobile chunk load failed: {String(e)}</div>);
    });
} else {
  cssPromise
    .then(() => import("./app-shell/DesktopApp"))
    .then(({ DesktopApp }) => {
      root.render(
        <React.StrictMode>
          {/* HintProvider 仅桌面树:悬浮提示消费 data-hint 系属性,mobile 无此面。 */}
          <IconContext.Provider value={ICON_CONTEXT}>
            <HintProvider>
              <DesktopApp />
            </HintProvider>
          </IconContext.Provider>
        </React.StrictMode>,
      );
    })
    .catch((e) => {
      root.render(<div style={{ padding: 24, color: "#c33" }}>app chunk load failed: {String(e)}</div>);
    });
}
