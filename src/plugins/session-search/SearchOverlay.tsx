/**
 * 会话检索浮层(原壳)── search 插件禁用时的 fallback 路径(D-03):
 * portal + 遮罩点击 + Esc + 无工作区不开门;本体在 ./SearchBody
 * (search 启用时由 search 统一壳以 kind="sessions" 承载,本壳不注册)。
 */

import { createPortal } from "react-dom";
import { getActiveWorkspace } from "@kernel/workspace";
import { closeSessionSearch, useSessionSearchOpen } from "./overlayStore";
import { SessionSearchBody, SessionSearchToast } from "./SearchBody";

export { ResultBody } from "./SearchOverlayParts";

export function SessionSearchOverlay() {
  const open = useSessionSearchOpen();
  const cwd = getActiveWorkspace()?.root;
  return createPortal(
    <>
      {/* 全屏容器(z-1201)统一收 Esc 与遮罩点击(自靶判定):容器自身即覆盖
          全屏,独立捕获层会被其整体遮蔽成死代码,故不设。 */}
      {open && cwd && (
        <div
          role="presentation"
          className="fixed inset-0 z-[1201] flex items-start justify-center bg-black/45 px-4 pt-[12vh]"
          data-icon-decor="search"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeSessionSearch();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !e.nativeEvent.isComposing) closeSessionSearch();
          }}
          data-testid="session-search-backdrop"
        >
          <SessionSearchBody open onRequestClose={closeSessionSearch} />
        </div>
      )}
      <SessionSearchToast />
    </>,
    document.body,
  );
}
