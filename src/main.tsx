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

/* Promise.withResolvers = Safari 17.4+;壳声明支持 iOS 16.0(transportBridge/gate 依赖)。
   四行垫片,三树(壳/桌面/浏览器)统一兜底,免得抬 deploymentTarget 砍 16.x 用户。 */
if (!Promise.withResolvers) {
  Promise.withResolvers = function <T>() {
    let resolve!: (v: T | PromiseLike<T>) => void;
    let reject!: (r?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

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
