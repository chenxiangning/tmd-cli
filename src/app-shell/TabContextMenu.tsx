/**
 * 文件 tab 右键菜单 —— 复刻 SessionContextMenu 的 wsmenu 范式
 * (portal + fixed + backdrop + Escape 关闭;plugins 的 clampMenuPosition
 * 不可反向 import,此处本地实现简化版视口夹取)。
 *
 * 项集:关闭 / 关闭其他 tab / 关闭全部 tab —— 作用于被右键的 tab,
 * 不强制激活;dirty tab 与 × 按钮一致不加确认。
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { SquareX, X, XCircle } from "lucide-react";

/** 菜单约 180×120:以点击点为左上,在视口内夹取。 */
function clampPosition(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(x, window.innerWidth - 180 - 12),
    y: Math.min(y, window.innerHeight - 120 - 12),
  };
}

export function TabContextMenu({
  position,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
  onClose,
}: {
  position: { x: number; y: number };
  onCloseTab: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
  onClose: () => void;
}) {
  const pos = clampPosition(position.x, position.y);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div
        className="wsmenu-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div className="wsmenu session-menu" style={{ left: pos.x, top: pos.y }}>
        <button
          className="wsmenu-item"
          onClick={() => {
            onCloseTab();
            onClose();
          }}
        >
          <span className="wsmenu-item-icon">
            <X size={13} />
          </span>
          <span className="wsmenu-item-label">关闭</span>
        </button>
        <button
          className="wsmenu-item"
          onClick={() => {
            onCloseOthers();
            onClose();
          }}
        >
          <span className="wsmenu-item-icon">
            <SquareX size={13} />
          </span>
          <span className="wsmenu-item-label">关闭其他 tab</span>
        </button>
        <button
          className="wsmenu-item"
          onClick={() => {
            onCloseAll();
            onClose();
          }}
        >
          <span className="wsmenu-item-icon">
            <XCircle size={13} />
          </span>
          <span className="wsmenu-item-label">关闭全部 tab</span>
        </button>
      </div>
    </>,
    document.body,
  );
}
