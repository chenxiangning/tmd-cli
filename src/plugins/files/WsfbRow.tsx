/**
 * 侧栏文件浏览器行与 ⋯ 菜单 —— 视觉件(自 WorkspaceFileBrowser 拆出,
 * 文件规模铁则)。行样式复用右栏 .file-tree-* 类 + 侧栏装饰:
 * 变更文件行尾字母 / 目录行尾圆点 / 忽略行降显 / 展开箭头常显。
 * 装饰件拆小组件降分支(react-doctor no-high-complexity)。
 */

import { createPortal } from "react-dom";
import { CaretRight, Copy, FolderOpen } from "@phosphor-icons/react";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { resolveFileVisual } from "@kernel/fileVisual";
import { copyText } from "@kernel/clipboard";

/** 行装饰:letter 仅文件有;目录 = 圆点。 */
export interface RowDeco {
  letter?: string;
  color: string;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span className={`file-tree-chevron wsfb-chevron${open ? " is-open" : ""}`} aria-hidden>
      <CaretRight size="0.6875rem" />
    </span>
  );
}

function DecoMark({ deco }: { deco: RowDeco }) {
  return (
    <span
      className={`wsfb-mark${deco.letter ? "" : " wsfb-mark-dot"} ${deco.color}`}
      aria-hidden
    >
      {deco.letter ?? ""}
    </span>
  );
}

export function WsfbRow({
  path,
  name,
  isDir,
  open,
  depth,
  deco,
  dim,
  selected,
  expandable = true,
  onContextMenu,
  onClick,
}: {
  path: string;
  name: string;
  isDir: boolean;
  open: boolean;
  depth: number;
  deco: RowDeco | null;
  dim: boolean;
  selected: boolean;
  expandable?: boolean;
  /** 右键 = 右栏同款文件树菜单(useTreeOperations.openMenu)。 */
  onContextMenu?: (e: React.MouseEvent) => void;
  onClick: () => void;
}) {
  const hint = resolveFileVisual(name, isDir, open);
  const color = deco?.color ?? hint.colorClass ?? "text-(--tmd-fg)";
  const showChevron = isDir && expandable;
  return (
    <div className={`file-tree-row-wrap wsfb-row-wrap${selected ? " is-selected" : ""}`}>
      <button
        type="button"
        className={`file-tree-row wsfb-row${selected ? " is-selected" : ""}${dim ? " wsfb-dim" : ""}`}
        style={{ paddingLeft: depth * 14 + 8 }}
        title={path}
        onContextMenu={onContextMenu}
        onClick={onClick}
        aria-expanded={showChevron ? open : undefined}
      >
        <span className={`file-tree-icon-cell${isDir ? " has-chevron" : ""}`}>
          {showChevron && <Chevron open={open} />}
          <span className="file-tree-icon" aria-hidden>
            <span
              className="file-tree-icon-svg"
              dangerouslySetInnerHTML={{ __html: hint.svgHtml }}
            />
          </span>
        </span>
        <span className={`file-tree-name ${color}${deco ? " font-semibold" : ""}`}>{name}</span>
        {deco && <DecoMark deco={deco} />}
      </button>
    </div>
  );
}

/** ⋯ 菜单(wsmenu 范式):访达显示 / 复制根路径。 */
export function WsfbMoreMenu({
  root,
  position,
  onClose,
}: {
  root: string;
  position: { x: number; y: number };
  onClose: () => void;
}) {
  const item = (label: string, icon: React.ReactNode, onPick: () => void) => (
    <button
      type="button"
      className="wsmenu-item"
      onClick={() => {
        onPick();
        onClose();
      }}
    >
      <span className="wsmenu-item-icon">{icon}</span>
      <span className="wsmenu-item-label">{label}</span>
    </button>
  );
  return createPortal(
    <>
      <div
        className="wsmenu-backdrop"
        role="presentation"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="wsmenu session-menu"
        style={{ left: position.x, top: position.y }}
        role="menu"
      >
        {item(
          t("在访达中显示"),
          <FolderOpen size="0.8125rem" />,
          () => void ipc.fsRevealInFileManager(root).catch(() => {}),
        )}
        {item(t("复制路径"), <Copy size="0.8125rem" />, () => void copyText(root))}
      </div>
    </>,
    document.body,
  );
}
