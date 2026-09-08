/**
 * 文件/文件夹行 —— 自 index.tsx 拆出(文件规模铁则)。
 *
 * 点击开 tab;右键呼菜单;hover 右侧 = 在访达中显示 + 复制路径;
 * 图标/颜色走 fileVisual。拖拽写 kernel 共享 payload(composer drop 时读),
 * 并兜底 text/plain 允许拖到外部应用。
 */

import { CaretRight, Copy, FolderOpen } from "@phosphor-icons/react";
import type { DirEntry } from "@kernel/ipc";
import { clearDragPayload, setDragPayload } from "@kernel/internalDrag";
import { t } from "@kernel/i18n";
import { resolveFileVisual } from "@kernel/fileVisual";

export function FileTreeRow({
  entry,
  depth,
  expanded,
  selected,
  decoColor,
  repoTag,
  onClick,
  onContextMenu,
  onCopyPath,
  onReveal,
}: {
  entry: DirEntry;
  depth: number;
  expanded: boolean;
  selected: boolean;
  /** Git 变更着色(开启 diff 过滤时由 FileTree 传入);缺省走 fileVisual 色。 */
  decoColor?: string;
  /** 仓根行标注(分支,submodule/worktree 带类型);非仓根缺省不显示。 */
  repoTag?: string;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onCopyPath: () => void;
  onReveal: () => void;
}) {
  const hint = resolveFileVisual(entry.name, entry.isDir, expanded);
  const color = decoColor ?? hint.colorClass ?? "text-(--tmd-fg)";

  /* 文件/文件夹拖到 composer:写 kernel 共享 payload,composer drop 时读 */
  function handleDragStart(e: React.DragEvent<HTMLButtonElement>) {
    e.dataTransfer.effectAllowed = "copy";
    /* 兜底:也写 text/plain,允许拖到外部应用 */
    e.dataTransfer.setData("text/plain", entry.path);
    setDragPayload({ path: entry.path, isDir: entry.isDir, name: entry.name });
  }
  function handleDragEnd() {
    /* 无论 drop 是否成功,结束都清 payload,防止跨拖拽残留 */
    clearDragPayload();
  }

  return (
    <div className={`file-tree-row-wrap${selected ? " is-selected" : ""}`}>
      <button
        type="button"
        className={`file-tree-row${selected ? " is-selected" : ""}`}
        style={{ paddingLeft: depth * 12 + 12 }}
        onClick={onClick}
        onContextMenu={onContextMenu}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        aria-expanded={entry.isDir ? expanded : undefined}
      >
        <span className={`file-tree-icon-cell${entry.isDir ? " has-chevron" : ""}`}>
          {entry.isDir ? (
            <>
              <span
                className={`file-tree-chevron${expanded ? " is-open" : ""}`}
                aria-hidden
              >
                <CaretRight size="0.6875rem" />
              </span>
              <span className="file-tree-icon" aria-hidden>
                <span
                  className="file-tree-icon-svg"
                  dangerouslySetInnerHTML={{ __html: hint.svgHtml }}
                />
              </span>
            </>
          ) : (
            <span className="file-tree-icon" aria-hidden>
              <span
                className="file-tree-icon-svg"
                dangerouslySetInnerHTML={{ __html: hint.svgHtml }}
              />
            </span>
          )}
        </span>
        <span className={`file-tree-name ${color}${decoColor ? " font-semibold" : ""}`}>
          {entry.name}
        </span>
        {repoTag && <span className="file-tree-repotag">{repoTag}</span>}
      </button>
      <span className="file-tree-actions">
        {/* 在访达中显示 ─ 设计参考图 hover 组首位(开口文件夹 icon) */}
        <button
          type="button"
          className="file-tree-action"
          onClick={(ev) => {
            ev.stopPropagation();
            onReveal();
          }}
          onContextMenu={(ev) => {
            ev.preventDefault();
            onContextMenu(ev);
          }}
          aria-label={t("在访达中显示")}
          title={t("在访达中显示")}
        >
          <FolderOpen aria-hidden size="0.6875rem" />
        </button>
        <button
          type="button"
          className="file-tree-action"
          onClick={(ev) => {
            ev.stopPropagation();
            onCopyPath();
          }}
          onContextMenu={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            onContextMenu(ev);
          }}
          aria-label={t("复制路径")}
          title={t("复制路径")}
        >
          <Copy aria-hidden size="0.6875rem" />
        </button>
      </span>
    </div>
  );
}
