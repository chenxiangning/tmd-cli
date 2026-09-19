/**
 * 引用/定义 peek 浮窗 —— monaco ReferencesWidget 同款形态的极简实现:
 * 符号行下方浮层面板,左 = 目标文件源码预览(Prism 语法高亮 + 当前行 +
 * 符号区间行内高亮),右 = 引用列表(peekList.ts:键盘导航/行文本回填)。
 * Esc/点击外部关闭;滚动不关(对齐 VS Code 停留语义),外点走 document 捕获。
 * 纯文本预览是九成价值;若需要行内编辑再升级为 CM 实例。
 */

import type { EditorView } from "@codemirror/view";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { openFileAtLine } from "@kernel/fileTabs";
import { highlightLine } from "@kernel/syntaxHighlight";
import { buildPeekList } from "./peekList";

export interface PeekItem {
  path: string;
  /** 1 基行号。 */
  line: number;
  /** 符号起始列(UTF-16 code unit,0 基);缺省无行内高亮。 */
  startChar?: number;
  /** 符号结束列;null = 跨行符号,高亮到行尾。 */
  endChar?: number | null;
}

/** 单个 peek 最多渲染的条数(server 侧无 cap 时兜底)。 */
const MAX_ITEMS = 200;
const PREVIEW_CONTEXT = 8;

let host: HTMLDivElement | null = null;
let ownerView: EditorView | null = null;
let teardown: (() => void) | null = null;
/* 预览异步回填代际令牌:peek 替换/关闭后作废旧写。 */
let generation = 0;

export function peekOpen(): boolean {
  if (host && !host.isConnected) {
    /* tab 关闭 DOM 已移除但全局变量残留:失连自清,防 Escape 被白吞。 */
    host = null;
    teardown?.();
    teardown = null;
    ownerView = null;
  }
  return host !== null;
}

export function closePeek(opts?: { refocus?: boolean }): void {
  generation += 1;
  host?.remove();
  host = null;
  teardown?.();
  teardown = null;
  const view = ownerView;
  ownerView = null;
  if (opts?.refocus) view?.contentDOM.focus();
}

/** 编辑器销毁时收浮层(仅限本 view 开的,不误关他人)。 */
export function closePeekIfOwner(view: EditorView): void {
  if (ownerView === view) closePeek();
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
  ownerView = view;
  host = document.createElement("div");
  host.className = "lsp-peek";
  host.innerHTML = `<div class="lsp-peek-header"><span class="lsp-peek-title"></span><button class="lsp-peek-close" title="Esc">×</button></div><div class="lsp-peek-body"></div>`;
  (host.querySelector(".lsp-peek-title") as HTMLElement).textContent = title;
  host.querySelector(".lsp-peek-close")?.addEventListener("click", () => closePeek({ refocus: true }));
  view.dom.appendChild(host);
  place(view, anchorPos);
  /* 外点关闭(document 捕获,先于编辑器 mousedown);滚动不关。 */
  const onDown = (e: MouseEvent) => {
    if (host && e.target instanceof Node && !host.contains(e.target)) closePeek();
  };
  document.addEventListener("mousedown", onDown, true);
  teardown = () => document.removeEventListener("mousedown", onDown, true);
  return host;
}

/** 引用/定义检索中(延迟上屏,结果到达后 showPeek 替换)。 */
export function showPeekLoading(view: EditorView, anchorPos: number, title: string): void {
  const el = mount(view, anchorPos, title);
  const body = el.querySelector(".lsp-peek-body") as HTMLElement;
  body.innerHTML = `<div class="lsp-peek-empty">${t("检索中…")}</div>`;
}

/* 扩展名 → Prism 语言 id(预览语法高亮;常见族,缺省原样转义)。 */
const PRISM_LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  py: "python",
  java: "java",
  rs: "rust",
  go: "go",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  css: "css",
  scss: "scss",
  json: "json",
  sh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  sql: "sql",
  rb: "ruby",
  kt: "kotlin",
  swift: "swift",
  php: "php",
};

function prismLangOf(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  return PRISM_LANG_BY_EXT[path.slice(dot + 1).toLowerCase()] ?? null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function previewRow(n: number, text: string, lang: string | null, item: PeekItem): HTMLDivElement {
  const row = document.createElement("div");
  const current = n === item.line;
  row.className = current ? "lsp-peek-code-row lsp-peek-code-cur" : "lsp-peek-code-row";
  const gutter = document.createElement("span");
  gutter.className = "lsp-peek-code-n";
  gutter.textContent = String(n);
  const code = document.createElement("span");
  code.className = "lsp-peek-code-t";
  const clipped = text.length > 500 ? `${text.slice(0, 500)}…` : text || " ";
  if (current && item.startChar !== undefined) {
    /* 当前行符号区间行内高亮:原始串按 UTF-16 列切三段逐段转义(实体不改列序)。 */
    const end = item.endChar == null ? clipped.length : Math.min(item.endChar, clipped.length);
    const start = Math.min(item.startChar, end);
    code.innerHTML =
      escapeHtml(clipped.slice(0, start)) +
      `<span class="lsp-peek-sym">${escapeHtml(clipped.slice(start, end))}</span>` +
      escapeHtml(clipped.slice(end));
  } else {
    code.innerHTML = highlightLine(clipped, lang);
  }
  row.append(gutter, code);
  return row;
}

async function renderPreview(el: HTMLElement, item: PeekItem) {
  const gen = generation;
  el.textContent = "";
  try {
    const text = await ipc.fsReadFile(item.path);
    if (gen !== generation) return; // peek 已替换/关闭:弃写
    const lines = text.split("\n");
    const lang = prismLangOf(item.path);
    const from = Math.max(1, item.line - PREVIEW_CONTEXT);
    const to = Math.min(lines.length, item.line + PREVIEW_CONTEXT);
    for (let n = from; n <= to; n++) el.appendChild(previewRow(n, lines[n - 1] ?? "", lang, item));
  } catch {
    if (gen === generation) el.innerHTML = `<div class="lsp-peek-empty">${t("无法读取预览")}</div>`;
  }
}

/** 展示结果;items 空 = 「无结果」占位。 */
export function showPeek(view: EditorView, anchorPos: number, title: string, items: readonly PeekItem[]): void {
  const el = mount(view, anchorPos, title);
  const body = el.querySelector(".lsp-peek-body") as HTMLElement;
  body.textContent = "";
  if (items.length === 0) {
    body.innerHTML = `<div class="lsp-peek-empty">${t("无结果")}</div>`;
    return;
  }
  const shown = items.slice(0, MAX_ITEMS);
  if (items.length > MAX_ITEMS) {
    (el.querySelector(".lsp-peek-title") as HTMLElement).textContent =
      `${title}·${t("显示前 {n} 条", { n: MAX_ITEMS })}`;
  }
  const preview = document.createElement("div");
  preview.className = "lsp-peek-preview";
  const list = buildPeekList(shown, {
    onSelect: (item) => void renderPreview(preview, item),
    onJump: (item) => {
      closePeek();
      openFileAtLine(item.path, item.line);
    },
    onClose: () => closePeek({ refocus: true }),
  });
  body.append(preview, list.el);
  void renderPreview(preview, shown[0]);
  list.focus();
}
