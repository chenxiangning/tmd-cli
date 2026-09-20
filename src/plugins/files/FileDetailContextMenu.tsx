/**
 * 文件详情页右键菜单 —— 参考 JetBrains 编辑器右键菜单裁剪出的最小可用集:
 *
 *   编辑态  剪切/复制/粘贴(CodeMirror 事务直驱)─ 复制路径/在访达中显示
 *          ─ 预览·编辑切换(md/结构化)─ 保存(脏态可用)
 *   预览态  复制(DOM 选区)─ 复制路径/在访达中显示 ─ 编辑切换
 *   字节态  复制路径/在访达中显示
 *
 * 参考图中的 Git 子菜单/定位到文件未做:仓库尚无按文件历史/blame 视图与
 * 文件树定位契约,不造空项。视觉走 wsmenu 范式(FileTreeContextMenu 同款:
 * portal + backdrop + Escape + 视口夹取)。
 *
 * 粘贴走 navigator.clipboard.readText:WKWebView 拒绝授权时静默失败,
 * 原生 ⌘V(CodeMirror 内建)始终可用。
 */

import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { EditorView } from "@codemirror/view";
import { ClipboardText, Copy, Eye, FloppyDisk, FolderOpen, Pencil, Scissors } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { ipc } from "@kernel/ipc";
import { clampMenuPosition, copyText } from "./useTreeOperations";

export interface DetailMenuPos {
  x: number;
  y: number;
}

export type DetailMenuVariant = "editor" | "preview" | "byte";

type Pick = (run: () => void) => void;

interface FileDetailContextMenuProps {
  state: DetailMenuPos;
  variant: DetailMenuVariant;
  path: string;
  /** 编辑器实例(仅编辑态有值):剪切/粘贴直接驱使 CodeMirror 事务。 */
  view: EditorView | null;
  /** 开启菜单瞬间的选区文本快照(点菜单不会丢它;空串 = 无选区)。 */
  selText: string;
  /** 只读(远程文件):剪切/粘贴/保存禁用,路径/访达两项不出。 */
  remote?: boolean;
  /** 有未落盘草稿时保存项可用。 */
  dirty?: boolean;
  /** md/结构化:多一档 编辑↔预览 切换。 */
  canToggle?: boolean;
  /** 当前为编辑态:切换项文案给「预览」,否则给「编辑」。 */
  editorOpen?: boolean;
  onToggle?: () => void;
  onSave?: () => void;
  onClose: () => void;
}

/** 菜单行构造(同 FileTreeContextMenu.item,多快捷键提示与禁用态)。 */
function item(
  label: string,
  icon: ReactNode,
  onPick: () => void,
  extra?: { kbd?: string; disabled?: boolean },
) {
  return (
    <button type="button" className="wsmenu-item" disabled={extra?.disabled} onClick={onPick}>
      <span className="wsmenu-item-icon">{icon}</span>
      <span className="wsmenu-item-label">{label}</span>
      {extra?.kbd ? <span className="wsmenu-item-kbd">{extra.kbd}</span> : null}
    </button>
  );
}

/** 编辑态剪贴板三项:剪切/复制走选区快照,剪切/粘贴直驱 CodeMirror 事务。 */
function editorClipItems(view: EditorView, selText: string, remote: boolean, pick: Pick) {
  const cutCopy = () => {
    const { from, to } = view.state.selection.main;
    void copyText(view.state.sliceDoc(from, to));
    return { from, to };
  };
  return (
    <>
      {item(t("剪切"), <Scissors size="0.8125rem" />, () =>
        pick(() => {
          const { from, to } = cutCopy();
          view.dispatch({ changes: { from, to } });
        }), { kbd: "⌘X", disabled: remote || !selText })}
      {item(t("复制"), <Copy size="0.8125rem" />, () =>
        pick(() => void cutCopy()), { kbd: "⌘C", disabled: !selText })}
      {item(t("粘贴"), <ClipboardText size="0.8125rem" />, () =>
        pick(() => {
          void navigator.clipboard.readText().then((text) => {
            if (!text) return;
            const { from, to } = view.state.selection.main;
            view.dispatch({
              changes: { from, to, insert: text },
              selection: { anchor: from + text.length },
              scrollIntoView: true,
            });
            view.focus();
          }, () => undefined);
        }), { kbd: "⌘V", disabled: remote })}
    </>
  );
}

/** 预览态:仅复制 DOM 选区快照。 */
function previewCopyItem(selText: string, pick: Pick) {
  return item(t("复制"), <Copy size="0.8125rem" />, () =>
    pick(() => void copyText(selText)), { disabled: !selText });
}

/** 路径两项:复制路径 + 在访达中显示(本地文件专属)。 */
function pathItems(path: string, pick: Pick) {
  return (
    <>
      {item(t("复制路径"), <Copy size="0.8125rem" />, () => pick(() => void copyText(path)))}
      {item(t("在访达中显示"), <FolderOpen size="0.8125rem" />, () =>
        pick(() => void ipc.fsRevealInFileManager(path).catch(() => undefined)),
      )}
    </>
  );
}

export function FileDetailContextMenu({
  state,
  variant,
  path,
  view,
  selText,
  remote = false,
  dirty = false,
  canToggle = false,
  editorOpen = false,
  onToggle,
  onSave,
  onClose,
}: FileDetailContextMenuProps) {
  const pos = clampMenuPosition(state.x, state.y);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* 先执行后关单:run 里的异步剪贴板操作不阻塞菜单关闭。 */
  const pick: Pick = (run) => {
    run();
    onClose();
  };

  const isEditor = variant === "editor" && view !== null;
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
      <div className="wsmenu session-menu" style={{ left: pos.x, top: pos.y }} role="menu">
        {isEditor && (
          <>
            {editorClipItems(view, selText, remote, pick)}
            <div className="wsmenu-divider" />
          </>
        )}
        {variant === "preview" && (
          <>
            {previewCopyItem(selText, pick)}
            <div className="wsmenu-divider" />
          </>
        )}
        {!remote && pathItems(path, pick)}
        {canToggle && onToggle && (
          <>
            <div className="wsmenu-divider" />
            {item(
              editorOpen ? t("预览") : t("编辑"),
              editorOpen ? <Eye size="0.8125rem" /> : <Pencil size="0.8125rem" />,
              () => pick(onToggle),
            )}
          </>
        )}
        {isEditor && onSave && (
          <>
            <div className="wsmenu-divider" />
            {item(t("保存"), <FloppyDisk size="0.8125rem" />, () => pick(onSave), {
              kbd: "⌘S",
              disabled: remote || !dirty,
            })}
          </>
        )}
      </div>
    </>,
    document.body,
  );
}

/** 详情页右键菜单接线:开单瞬间快照选区文本,返回 触发器属性 与 菜单节点。 */
export function useFileDetailMenu(opts: {
  variant: DetailMenuVariant;
  path: string;
  viewRef: RefObject<EditorView | null>;
  remote?: boolean;
  dirty?: boolean;
  canToggle?: boolean;
  editorOpen?: boolean;
  onToggle?: () => void;
  onSave?: () => void;
}): { detailMenuProps: { onContextMenu: (e: React.MouseEvent) => void }; detailMenu: ReactNode } {
  const [pos, setPos] = useState<DetailMenuPos | null>(null);
  const [selText, setSelText] = useState("");
  const detailMenuProps = {
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      const v = opts.viewRef.current;
      setSelText(
        v
          ? v.state.selection.main.from !== v.state.selection.main.to
            ? v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)
            : ""
          : (document.getSelection()?.toString() ?? ""),
      );
      setPos({ x: e.clientX, y: e.clientY });
    },
  };
  const detailMenu = pos ? (
    <FileDetailContextMenu
      state={pos}
      variant={opts.variant}
      path={opts.path}
      view={opts.viewRef.current}
      selText={selText}
      remote={opts.remote}
      dirty={opts.dirty}
      canToggle={opts.canToggle}
      editorOpen={opts.editorOpen}
      onToggle={opts.onToggle}
      onSave={opts.onSave}
      onClose={() => setPos(null)}
    />
  ) : null;
  return { detailMenuProps, detailMenu };
}
