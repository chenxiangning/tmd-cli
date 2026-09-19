/**
 * 编辑器右键菜单(转到定义/查找引用)—— vanilla DOM 极简浮层。
 * server 启动中(opening)两项置灰 + 提示行;点击项外/Esc/滚动即关,
 * Esc 分支在 cmLsp 键位统一处理。
 */

import type { EditorView } from "@codemirror/view";
import { t } from "@kernel/i18n";

export interface ContextMenuActions {
  /** server 连接态:opening 时菜单项置灰(spec:未就绪置灰,不做空动作)。 */
  serverState: "none" | "opening" | "ready";
  definition: () => void;
  references: () => void;
}

let menu: HTMLDivElement | null = null;
let ownerView: EditorView | null = null;
let teardown: (() => void) | null = null;

export function contextMenuOpen(): boolean {
  if (menu && !menu.isConnected) {
    /* tab 关闭 DOM 已移除但全局变量残留:失连自清,防 Escape 被白吞。 */
    menu = null;
    teardown?.();
    teardown = null;
    ownerView = null;
  }
  return menu !== null;
}

export function closeContextMenu(): void {
  menu?.remove();
  menu = null;
  teardown?.();
  teardown = null;
  ownerView = null;
}

/** 编辑器销毁时收菜单(仅限本 view 开的,不误关他人)。 */
export function closeContextMenuIfOwner(view: EditorView): void {
  if (ownerView === view) closeContextMenu();
}

export function openContextMenu(
  view: EditorView,
  x: number,
  y: number,
  actions: ContextMenuActions,
): void {
  closeContextMenu();
  ownerView = view;
  menu = document.createElement("div");
  menu.className = "lsp-menu";
  const editorRect = view.dom.getBoundingClientRect();
  const disabled = actions.serverState === "opening";
  for (const [label, run] of [
    [t("转到定义"), actions.definition],
    [t("查找引用"), actions.references],
  ] as const) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "lsp-menu-item";
    item.textContent = label;
    item.disabled = disabled;
    item.addEventListener("click", () => {
      closeContextMenu();
      run();
    });
    menu.appendChild(item);
  }
  if (disabled) {
    const hint = document.createElement("div");
    hint.className = "lsp-menu-hint";
    hint.textContent = t("语言服务启动中…");
    menu.appendChild(hint);
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
