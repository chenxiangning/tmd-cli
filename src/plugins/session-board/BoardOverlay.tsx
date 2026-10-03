/**
 * 会话看板覆盖层 —— overlay 挂点贡献,与插件市场同款切换效果:
 * 不透明盖住 titlebar 之下主区(下层保持挂载,会话现场/分栏零回放),
 * 左 rail 看板钮(2026-10-04 迁入,被本覆盖层盖住)、工具条 × 或 Esc 收起。
 * BoardTab 自带工具栏/月历/日视图,这里只补覆盖壳 + Esc 链。
 */
import { useEffect, useSyncExternalStore } from "react";
import { BoardTab } from "./BoardTab";
import {
  boardOverlayOpen,
  closeBoardOverlay,
  subscribeBoardOverlay,
} from "./boardOverlayStore";

export function BoardOverlay() {
  const open = useSyncExternalStore(subscribeBoardOverlay, boardOverlayOpen);
  /* Esc 收板:日视图开着时让位(BoardTab 先收日视图,本 handler 查 DOM 仍见 .sb-day
     即跳过;下一次 Esc 才收板 —— 两段式 Esc 与弹层级语义一致)。 */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]")) return;
      if (document.querySelector(".sb-day")) return;
      closeBoardOverlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div className="sb-overlay-page">
      <BoardTab />
    </div>
  );
}
