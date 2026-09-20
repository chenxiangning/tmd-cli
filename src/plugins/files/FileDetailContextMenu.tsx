/**
 * 文件详情页右键菜单 —— JetBrains 同型裁剪:发送到输入框/剪贴板(CM 事务直驱)/
 * 复制路径/访达/Git 操作子菜单/定位到文件(右栏+侧栏双树同步)/扩选 ⌘W/
 * 编辑预览切换/保存。Git 项仅本地文件且在活跃工作区内;路径口径 = 根相对(同 DiffView)。
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { EditorView } from "@codemirror/view";
import {
  ChatText,
  ClipboardText,
  Copy,
  Crosshair,
  Eye,
  FloppyDisk,
  FolderOpen,
  Pencil,
  Scissors,
  Selection,
} from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { ipc } from "@kernel/ipc";
import { composerInsertRef } from "@kernel/composerExt";
import { getActiveWorkspace } from "@kernel/workspace";
import { clampMenuPosition, copyText } from "./useTreeOperations";
import { collectRevealTargets } from "./treeHandles";
import { expandEditorSelection } from "@kernel/cmEditor/expandSelection";
import { item, type Pick } from "./wsmenuItem";
import { FileDetailGitSubmenu } from "./FileDetailGitSubmenu";

export interface DetailMenuPos { x: number; y: number }
export type DetailMenuVariant = "editor" | "preview" | "byte";

interface FileDetailContextMenuProps {
  state: DetailMenuPos;
  variant: DetailMenuVariant;
  path: string;
  /** 编辑器实例(仅编辑态有值):剪切/粘贴直接驱使 CodeMirror 事务。 */
  view: EditorView | null;
  /** 开启菜单瞬间的选区文本快照(点菜单不会丢它;空串 = 无选区)。 */
  selText: string;
  /** 只读(远程文件):剪切/粘贴/保存禁用,路径/Git/定位三项不出。 */
  remote?: boolean;
  dirty?: boolean; // 有未落盘草稿时保存项可用
  canToggle?: boolean; // md/结构化:多一档 编辑↔预览 切换
  editorOpen?: boolean; // 当前为编辑态:切换项文案给「预览」,否则给「编辑」
  /** blame 内嵌开关(仅本地编辑态出项):canBlame 显隐,active 定文案。 */
  canBlame?: boolean;
  blameActive?: boolean;
  onToggleBlame?: () => void;
  onToggle?: () => void;
  onSave?: () => void;
  onClose: () => void;
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
      {item(t("扩大选择范围"), <Selection size="0.8125rem" />, () =>
        pick(() => {
          void expandEditorSelection(view);
          view.focus();
        }), { kbd: "⌘W" })}
    </>
  );
}

/** 菜单全部行段(条件收敛在此,主组件只留壳;camelCase 构造函数非组件)。 */
function menuBody(p: FileDetailContextMenuProps & { pick: Pick }) {
  const { variant, path, view, selText, remote = false, dirty = false, canToggle, editorOpen, canBlame, blameActive, onToggleBlame, onToggle, onSave, pick } = p;
  const ws = getActiveWorkspace();
  const base = ws ? ws.root.replace(/[\\/]+$/, "") : "";
  const relPath = !remote && base && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : null;
  const revealTargets = !remote ? collectRevealTargets() : [];
  const sendText = selText || relPath || (!remote ? path : "");
  const isEditor = variant === "editor" && view !== null;
  return (
    <>
      {sendText && composerInsertRef.current && (
        <>
          {item(t("发送到输入框"), <ChatText size="0.8125rem" />, () =>
            pick(() => composerInsertRef.current?.(sendText)))}
          <div className="wsmenu-divider" />
        </>
      )}
      {isEditor && (
        <>
          {editorClipItems(view, selText, remote, pick)}
          <div className="wsmenu-divider" />
        </>
      )}
      {variant === "preview" && (
        <>
          {item(t("复制"), <Copy size="0.8125rem" />, () =>
            pick(() => void copyText(selText)), { disabled: !selText })}
          <div className="wsmenu-divider" />
        </>
      )}
      {!remote && (
        <>
          {item(t("复制路径"), <Copy size="0.8125rem" />, () => pick(() => void copyText(path)))}
          {item(t("在访达中显示"), <FolderOpen size="0.8125rem" />, () =>
            pick(() => void ipc.fsRevealInFileManager(path).catch(() => undefined)),
          )}
        </>
      )}
      {relPath && (
        <>
          <div className="wsmenu-divider" />
          <FileDetailGitSubmenu cwd={base} rel={relPath} pick={pick} blameActive={blameActive} onToggleBlame={canBlame ? onToggleBlame : undefined} />
        </>
      )}
      {revealTargets.length > 0 && (
        <>
          {!relPath && <div className="wsmenu-divider" />}
          {item(t("定位到文件"), <Crosshair size="0.8125rem" />, () =>
            pick(() => { for (const r of revealTargets) r(path); }), { kbd: "⌥F1" })}
        </>
      )}
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
  canBlame,
  blameActive,
  onToggleBlame,
  onToggle,
  onSave,
  onClose,
}: FileDetailContextMenuProps) {
  /* 子菜单要向右再伸 ~176px,夹取留量比树菜单更宽。 */
  const pos = clampMenuPosition(state.x, state.y);
  pos.x = Math.min(pos.x, window.innerWidth - 400 - 12);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* 先执行后关单:run 里的异步操作不阻塞菜单关闭。 */
  const pick: Pick = (run) => {
    run();
    onClose();
  };

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
        {menuBody({ state, variant, path, view, selText, remote, dirty, canToggle, editorOpen, canBlame, blameActive, onToggleBlame, onToggle, onSave, onClose, pick })}
      </div>
    </>,
    document.body,
  );
}
