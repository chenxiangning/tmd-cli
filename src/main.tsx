/**
 * 入口:按环境分流两棵独立 UI 树。
 * - 手机壳(__TMD_SHELL__=mobile):src/mobile 独立远程 UI(不加载桌面树)。
 * - 桌面/浏览器:动态 import app-shell/DesktopApp(与手机包 chunk 分离)。
 * 共享的只有数据面:@kernel/transport(RPC/事件)与少量 kernel 原语。
 */
import "./kernel/withResolversShim"; /* 首位:垫片先于一切静态图求值 */
import React from "react";
import ReactDOM from "react-dom/client";
import { isMobileShell } from "./mobile/shared";
import "./styles/global.css";
import "./mobile/mobile.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

if (isMobileShell()) {
  /* 双树皆动态:mobile 分支静态引 gate 会让桌面首包背上 mobile 树
   * (含 7 家 CLI 磁盘扫描器,评审 P1-2);对偶分支同构。 */
  void import("./mobile/gate").then(({ MobileRoot }) => {
    root.render(
      <React.StrictMode>
        <MobileRoot />
      </React.StrictMode>,
    );
  });
} else {
  void import("./app-shell/DesktopApp").then(({ DesktopApp }) => {
    root.render(
      <React.StrictMode>
        <DesktopApp />
      </React.StrictMode>,
    );
  });
}
