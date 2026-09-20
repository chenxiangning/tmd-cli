/**
 * 文件详情页右键菜单接线钩子 —— 开单瞬间快照选区文本(编辑器选区或 DOM 选区),
 * 供菜单组件判定 剪切/复制/发送到输入框 的可用性与注入内容。
 */

import { useState, type ReactNode, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { FileDetailContextMenu, type DetailMenuPos, type DetailMenuVariant } from "./FileDetailContextMenu";

export function useFileDetailMenu(opts: {
  variant: DetailMenuVariant;
  path: string;
  viewRef: RefObject<EditorView | null>;
  remote?: boolean;
  dirty?: boolean;
  canToggle?: boolean;
  editorOpen?: boolean;
  /** blame 内嵌模式:canBlame 控项显隐,active 显「隐藏」文案。 */
  canBlame?: boolean;
  blameActive?: boolean;
  onToggleBlame?: () => void;
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
      canBlame={opts.canBlame}
      blameActive={opts.blameActive}
      onToggleBlame={opts.onToggleBlame}
      onToggle={opts.onToggle}
      onSave={opts.onSave}
      onClose={() => setPos(null)}
    />
  ) : null;
  return { detailMenuProps, detailMenu };
}
