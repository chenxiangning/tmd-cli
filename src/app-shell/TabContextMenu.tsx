/**
 * 文件/会话 tab 右键菜单 —— 复刻 SessionContextMenu 的 wsmenu 范式
 * (portal + fixed + backdrop + Escape 关闭;plugins 的 clampMenuPosition
 * 不可反向 import,此处本地实现简化版视口夹取)。
 *
 * 关闭项集:关闭 / 关闭其他 tab / 关闭全部 tab —— 作用于被右键的 tab,
 * 不强制激活;dirty tab 与 × 按钮一致不加确认。
 * 可选首项「重命名」(传 onRename 启用,会话 tab 用):canRename=false 时禁用。
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Pencil, XSquare, Cross, XCircle } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";

/** 菜单约 180 宽:以点击点为左上,在视口内夹取;高度按项数(3 项 120 / 4 项 150)。 */
function clampPosition(
  x: number,
  y: number,
  height: number,
): { x: number; y: number } {
  return {
    x: Math.min(x, window.innerWidth - 180 - 12),
    y: Math.min(y, window.innerHeight - height - 12),
  };
}

export function TabContextMenu({
  position,
  onRename,
  canRename,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
  onClose,
}: {
  position: { x: number; y: number };
  /** 提供则首项显示「重命名」;canRename=false 时禁用(会话未落盘不可命名)。 */
  onRename?: () => void;
  canRename?: boolean;
  onCloseTab: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
  onClose: () => void;
}) {
  const pos = clampPosition(position.x, position.y, onRename ? 150 : 120);

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
        {onRename ? (
          <button
            className="wsmenu-item"
            disabled={canRename === false}
            title={canRename === false ? t("会话尚未落盘,暂不可命名") : undefined}
            onClick={() => {
              onRename();
              onClose();
            }}
          >
            <span className="wsmenu-item-icon">
              <Pencil size={13} />
            </span>
            <span className="wsmenu-item-label">{t("重命名")}</span>
          </button>
        ) : null}
        <button
          className="wsmenu-item"
          onClick={() => {
            onCloseTab();
            onClose();
          }}
        >
          <span className="wsmenu-item-icon">
            <Cross size={13} />
          </span>
          <span className="wsmenu-item-label">{t("关闭")}</span>
        </button>
        <button
          className="wsmenu-item"
          onClick={() => {
            onCloseOthers();
            onClose();
          }}
        >
          <span className="wsmenu-item-icon">
            <XSquare size={13} />
          </span>
          <span className="wsmenu-item-label">{t("关闭其他 tab")}</span>
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
          <span className="wsmenu-item-label">{t("关闭全部 tab")}</span>
        </button>
      </div>
    </>,
    document.body,
  );
}
