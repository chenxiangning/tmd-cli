/**
 * 会话行右键菜单 —— 活会话/磁盘会话/全局置顶区共用。
 * 复刻 wsmenu 视觉(portal + fixed + backdrop + Escape);删除为两步确认
 * (首击武装 → 再击执行),防误删物理文件。
 *
 * 置顶双作用域(codemoss 复刻):置顶到全局 / 置顶到工作区内。
 * 当前作用域带 ✓ 前缀,点当前 = 取消置顶,点另一 = 迁移作用域。
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Pencil, Pin, Trash2 } from "lucide-react";
import type { SessionPinScope } from "@kernel/sessionPins";
import { clampMenuPosition } from "./SessionMenu";

export function SessionContextMenu({
  position,
  /** 未绑定磁盘身份的活会话:不可重命名/置顶(覆盖层以 CLI 身份为 key)。 */
  canRename,
  /** 当前置顶作用域;null = 未置顶;undefined = 不可置顶(未落盘)。 */
  pinScope,
  onCopyId,
  onRename,
  onPinScope,
  onDelete,
  onClose,
}: {
  position: { x: number; y: number };
  canRename: boolean;
  pinScope: SessionPinScope | null | undefined;
  onCopyId: () => void;
  onRename: () => void;
  onPinScope: (scope: SessionPinScope) => void;
  /** 缺省时隐藏删除项(全局置顶区不持有磁盘文件路径,删除回工作区分组操作)。 */
  onDelete?: () => void;
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

  const pinItem = (scope: SessionPinScope, label: string) => (
    <button
      className="wsmenu-item"
      disabled={pinScope === undefined}
      title={pinScope === undefined ? "会话尚未落盘,暂不可置顶" : undefined}
      onClick={() => {
        onPinScope(scope);
        onClose();
      }}
    >
      <span className="wsmenu-item-icon">
        <Pin size={13} />
      </span>
      <span className="wsmenu-item-label">
        {pinScope === scope ? `✓ ${label}` : label}
      </span>
    </button>
  );

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
        {pinItem("global", "置顶到全局")}
        {pinItem("workspace", "置顶到工作区内")}
        {onDelete ? (
          <>
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
              <span className="wsmenu-item-label">
                {armed ? "确认删除?" : "删除会话"}
              </span>
            </button>
          </>
        ) : null}
      </div>
    </>,
    document.body,
  );
}
