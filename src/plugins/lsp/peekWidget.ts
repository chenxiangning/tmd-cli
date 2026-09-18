/**
 * 引用/定义 peek 浮窗 —— monaco ReferencesWidget 同款形态的极简实现:
 * 符号行下方嵌入面板,左 = 目标文件源码窗预览,右 = 命中列表,点击跳转。
 *
 * ponytail:v1 用 pre 风格窗预览(非嵌套只读 CM 实例),覆盖「看上下文+跳转」
 * 九成价值;若需要语法高亮/行内编辑再升级为 CM 实例。
 * Esc/滚动/点击外部关闭;Esc 经 cmLsp 键位,滚动/外点在此自挂。
 */

import type { EditorView } from "@codemirror/view";
import { ipc } from "@kernel/ipc";
import { normalizePath } from "@kernel/pathUtils";
import { openFileAtLine } from "@kernel/fileTabs";

export interface PeekItem {
  path: string;
  /** 1 基行号。 */
  line: number;
}

/** 单个 peek 最多渲染的行数/条数(server 侧无 cap 时兜底)。 */
const MAX_ITEMS = 200;
const PREVIEW_CONTEXT = 8;

let host: HTMLDivElement | null = null;
let teardown: (() => void) | null = null;

export function peekOpen(): boolean {
  return host !== null;
}

export function closePeek(): void {
  host?.remove();
  host = null;
  teardown?.();
  teardown = null;
}

/** 点击发生在 peek 外部时关闭(手势路径前置调用)。 */
export function closePeekIfOutside(target: EventTarget | null): void {
  if (host && target instanceof Node && !host.contains(target)) closePeek();
}

function place(view: EditorView, anchorPos: number) {
  if (!host) return;
  const editorRect = view.dom.getBoundingClientRect();
  const coords = view.coordsAtPos(anchorPos);
  const top = coords ? coords.bottom - editorRect.top + 6 : 12;
  host.style.left = "12px";
  host.style.right = "12px";
  host.style.top = `${Math.min(Math.max(top, 8), Math.max(editorRect.height - 180, 8))}px`;
}

function mount(view: EditorView, anchorPos: number, title: string) {
  closePeek();
  host = document.createElement("div");
  host.className = "lsp-peek";
  host.innerHTML = `<div class="lsp-peek-header"><span class="lsp-peek-title"></span><button class="lsp-peek-close" title="Esc">×</button></div><div class="lsp-peek-body"></div>`;
  (host.querySelector(".lsp-peek-title") as HTMLElement).textContent = title;
  host.querySelector(".lsp-peek-close")?.addEventListener("click", closePeek);
  view.dom.appendChild(host);
  place(view, anchorPos);
  const onScroll = () => closePeek();
  view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
  teardown = () => view.scrollDOM.removeEventListener("scroll", onScroll);
  return host;
}

/** 引用/定义检索中(立即上屏,结果到达后 showPeek 替换)。 */
export function showPeekLoading(view: EditorView, anchorPos: number, title: string): void {
  const el = mount(view, anchorPos, title);
  const body = el.querySelector(".lsp-peek-body") as HTMLElement;
  body.innerHTML = `<div class="lsp-peek-empty">检索中…</div>`;
}

function previewRow(n: number, text: string, current: boolean): HTMLDivElement {
  const row = document.createElement("div");
  row.className = current ? "lsp-peek-code-row lsp-peek-code-cur" : "lsp-peek-code-row";
  const gutter = document.createElement("span");
  gutter.className = "lsp-peek-code-n";
  gutter.textContent = String(n);
  const code = document.createElement("span");
  code.className = "lsp-peek-code-t";
  code.textContent = text.length > 500 ? `${text.slice(0, 500)}…` : text || " ";
  row.append(gutter, code);
  return row;
}

async function renderPreview(el: HTMLElement, item: PeekItem) {
  el.textContent = "";
  try {
    const text = await ipc.fsReadFile(item.path);
    const lines = text.split("\n");
    const from = Math.max(1, item.line - PREVIEW_CONTEXT);
    const to = Math.min(lines.length, item.line + PREVIEW_CONTEXT);
    for (let n = from; n <= to; n++) el.appendChild(previewRow(n, lines[n - 1] ?? "", n === item.line));
  } catch {
    el.innerHTML = `<div class="lsp-peek-empty">无法读取预览</div>`;
  }
}

function listRow(item: PeekItem): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "lsp-peek-row";
  const norm = normalizePath(item.path);
  const slash = norm.lastIndexOf("/");
  const base = slash < 0 ? norm : norm.slice(slash + 1);
  const dir = slash < 0 ? "" : norm.slice(0, slash);
  const name = document.createElement("div");
  name.className = "lsp-peek-row-name";
  name.innerHTML = `<span class="lsp-peek-row-base"></span><span class="lsp-peek-row-line"></span>`;
  (name.querySelector(".lsp-peek-row-base") as HTMLElement).textContent = base;
  (name.querySelector(".lsp-peek-row-line") as HTMLElement).textContent = `:${item.line}`;
  const path = document.createElement("div");
  path.className = "lsp-peek-row-path";
  path.textContent = dir;
  row.append(name, path);
  row.addEventListener("click", () => {
    openFileAtLine(norm, item.line);
    closePeek();
  });
  return row;
}

/** 展示结果;items 空 = 「无结果」占位。 */
export function showPeek(view: EditorView, anchorPos: number, title: string, items: readonly PeekItem[]): void {
  const el = mount(view, anchorPos, title);
  const body = el.querySelector(".lsp-peek-body") as HTMLElement;
  body.textContent = "";
  if (items.length === 0) {
    body.innerHTML = `<div class="lsp-peek-empty">无结果</div>`;
    return;
  }
  const preview = document.createElement("div");
  preview.className = "lsp-peek-preview";
  const list = document.createElement("div");
  list.className = "lsp-peek-list";
  const shown = items.slice(0, MAX_ITEMS);
  for (const item of shown) list.appendChild(listRow(item));
  body.append(preview, list);
  void renderPreview(preview, shown[0]);
}
