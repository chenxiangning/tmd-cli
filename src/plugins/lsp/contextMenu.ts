/**
 * 编辑器右键菜单(转到定义/查找引用)—— vanilla DOM 极简浮层。
 * 点击项外/Esc/滚动即关;Esc 分支在 cmLsp 键位统一处理。
 */

import type { EditorView } from "@codemirror/view";

export interface ContextMenuActions {
  definition: () => void;
  references: () => void;
}

let menu: HTMLDivElement | null = null;
let teardown: (() => void) | null = null;

export function contextMenuOpen(): boolean {
  return menu !== null;
}

export function closeContextMenu(): void {
  menu?.remove();
  menu = null;
  teardown?.();
  teardown = null;
}

export function openContextMenu(
  view: EditorView,
  x: number,
  y: number,
  actions: ContextMenuActions,
): void {
  closeContextMenu();
  menu = document.createElement("div");
  menu.className = "lsp-menu";
  const editorRect = view.dom.getBoundingClientRect();
  for (const [label, run] of [
    ["转到定义", actions.definition],
    ["查找引用", actions.references],
  ] as const) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "lsp-menu-item";
    item.textContent = label;
    item.addEventListener("click", () => {
      closeContextMenu();
      run();
    });
    menu.appendChild(item);
  }
  view.dom.appendChild(menu);
  /* 视口边缘兜底:先量再夹。 */
  const mw = menu.offsetWidth || 140;
  const mh = menu.offsetHeight || 60;
  menu.style.left = `${Math.min(Math.max(x - editorRect.left, 4), Math.max(editorRect.width - mw - 4, 4))}px`;
  menu.style.top = `${Math.min(Math.max(y - editorRect.top + 4, 4), Math.max(editorRect.height - mh - 4, 4))}px`;
  const onDown = (e: MouseEvent) => {
    if (menu && e.target instanceof Node && !menu.contains(e.target)) closeContextMenu();
  };
  const onScroll = () => closeContextMenu();
  document.addEventListener("mousedown", onDown, true);
  view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
  teardown = () => {
    document.removeEventListener("mousedown", onDown, true);
    view.scrollDOM.removeEventListener("scroll", onScroll);
  };
}
