/**
 * 会话行右键菜单 —— 活会话/磁盘会话共用。
 * 复刻 wsmenu 视觉(portal + fixed + backdrop + Escape);删除为两步确认
 * (首击武装 → 再击执行),防误删物理文件。
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { clampMenuPosition } from "./SessionMenu";

export function SessionContextMenu({
  position,
  /** 未绑定磁盘身份的活会话:不可重命名(覆盖层以 CLI 身份为 key)。 */
  canRename,
  onCopyId,
  onRename,
  onDelete,
  onClose,
}: {
  position: { x: number; y: number };
  canRename: boolean;
  onCopyId: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  /** 删除武装态:首击仅进入确认,再击才执行物理删除。 */
  const [armed, setArmed] = useState(false);
  const pos = clampMenuPosition(position.x, position.y);

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
            onCopyId();
            onClose();
          }}
        >
          <span className="wsmenu-item-icon">
            <Copy size={13} />
          </span>
          <span className="wsmenu-item-label">复制 Session ID</span>
        </button>
        <button
          className="wsmenu-item"
          disabled={!canRename}
          title={canRename ? undefined : "会话尚未落盘,暂不可命名"}
          onClick={() => {
            onRename();
            onClose();
          }}
        >
          <span className="wsmenu-item-icon">
            <Pencil size={13} />
          </span>
          <span className="wsmenu-item-label">重命名</span>
        </button>
        <div className="wsmenu-divider" />
        <button
          className={`wsmenu-item is-danger${armed ? " is-armed" : ""}`}
          onClick={() => {
            if (!armed) {
              setArmed(true);
              return;
            }
            onDelete();
            onClose();
          }}
        >
          <span className="wsmenu-item-icon">
            <Trash2 size={13} />
          </span>
          <span className="wsmenu-item-label">{armed ? "确认删除?" : "删除会话"}</span>
        </button>
      </div>
    </>,
    document.body,
  );
}
