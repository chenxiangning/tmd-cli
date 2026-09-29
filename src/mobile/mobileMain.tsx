/**
 * 手机壳专用入口(mobile-index.html → 本件):无条件走 mobile 树,桌面分支
 * 整棵不进产物 —— 手机壳(APK/iOS 包)拷 dist-mobile 而非全量 dist,免背
 * DesktopApp/codemirror/excalidraw 等桌面 chunk(~16MB)。桌面/双态入口
 * 仍是根 index.html + main.tsx(运行时按 __TMD_SHELL__ 分流),两入口
 * 共享 src/mobile/* 与 @kernel 数据面,渲染链与 main.tsx mobile 分支逐行同构。
 */
import "../kernel/withResolversShim"; /* 首位:垫片先于一切静态图求值 */
import React from "react";
import ReactDOM from "react-dom/client";
import { IconContext } from "@phosphor-icons/react";

const ICON_CONTEXT = { weight: "bold" } as const; /* 同 main.tsx:Phosphor 全局粗体 */

const root = ReactDOM.createRoot(document.getElementById("root")!);

import("./mobile.css")
  .then(() => import("./gate"))
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
