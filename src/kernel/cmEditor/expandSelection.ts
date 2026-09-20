/**
 * ⌘W 扩大选择(editor 作用域命令体)+ 活跃编辑器实例槽。
 * 独立非组件文件:命令注册/详情页菜单/编辑器聚焦桥三方共用,且避开
 * only-export-components(原放 FileCodeEditorImpl.tsx 记 3 笔非组件导出)。
 */

import type { EditorView } from "@codemirror/view";

/** 活跃编辑器实例槽(聚焦期馈入,失焦/卸载清空):内核 editor 作用域命令据此直驱 CM。 */
let activeEditorView: EditorView | null = null;

export function getActiveEditorView(): EditorView | null {
  return activeEditorView;
}

export function setActiveEditorView(view: EditorView | null): void {
  activeEditorView = view;
}

/** ⌘W 扩大选择(无语法树/语法树到底时退化词选择;词也没有则不动作)。
 *  绑定不在 CM keymap:内核分发器 window capture 先于 CM 吃键,经
 *  editor 作用域命令 editor.expandSelection 路由到此处(见 shortcutCommands);
 *  仅编辑器聚焦期接管,失焦期同键落回 shell.closeTab 关 tab。 */
export function expandSelectionFallback(view: EditorView): void {
  const sel = view.state.selection.main;
  const word = view.state.wordAt(sel.head);
  if (word && (sel.empty || word.from < sel.from || word.to > sel.to)) {
    view.dispatch({ selection: { anchor: word.from, head: word.to } });
  }
}

/** editor.expandSelection 命令与详情页右键菜单共用的 ⌘W 命令体。 */
export async function expandEditorSelection(view: EditorView): Promise<void> {
  /* 动态 import:@codemirror/commands 只属编辑器 lazy chunk,菜单/命令注册零负担。 */
  const { selectParentSyntax } = await import("@codemirror/commands");
  if (!selectParentSyntax(view)) expandSelectionFallback(view);
}
