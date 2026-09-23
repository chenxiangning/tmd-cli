/**
 * 入口:按环境分流两棵独立 UI 树。
 * - 手机壳(__TMD_SHELL__=mobile):src/mobile 独立远程 UI(不加载桌面树)。
 * - 桌面/浏览器:动态 import app-shell/DesktopApp(与手机包 chunk 分离)。
 * 共享的只有数据面:@kernel/transport(RPC/事件)与少量 kernel 原语。
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { MobileRoot } from "./mobile/gate";
import { isMobileShell } from "./mobile/shared";
import "./styles/global.css";
import "./mobile/mobile.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

if (isMobileShell()) {
  root.render(
    <React.StrictMode>
      <MobileRoot />
    </React.StrictMode>,
  );
} else {
  void import("./app-shell/DesktopApp").then(({ DesktopApp }) => {
    root.render(
      <React.StrictMode>
        <DesktopApp />
      </React.StrictMode>,
    );
  });
}
