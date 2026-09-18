/**
 * lsp 的 CodeMirror 扩展工厂 —— 手势/hover/文档同步/键位桥。
 *
 * 拆包红线(architecture/13):@codemirror/* 运行期一律动态 import。
 * 惰性:文件打开不拉 server,首个语义动作(手势/键位/命令/hover)才
 * ensureSync(spawn+initialize+didOpen);此后增量 didChange 同步。
 * 语义路由(spec):cmd/ctrl+click → definition;单目标直跳,definition
 * 结果包含点击位置(=点在定义上)或多目标 → 引用/列表 peek;Shift+F12 →
 * references peek(含声明);F12 → definition 同手势。
 */

import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { EditorExtensionFactory } from "@kernel/editorExtensions";
import { configForPath, owningWorkspaceRoot } from "@kernel/lsp/lspRegistry";
import { lspToOffset, offsetToLsp, type LspRange } from "@kernel/lsp/lspPosition";
import { openFileAtLine } from "@kernel/fileTabs";
import { normalizePath } from "@kernel/pathUtils";
import { closeContextMenu, contextMenuOpen, openContextMenu } from "./contextMenu";
import { closePeek, closePeekIfOutside, peekOpen, showPeek, showPeekLoading, type PeekItem } from "./peekWidget";
import { getSessionForPath, pathToUri, type DocChangeEvent, type LspDocSession } from "./session";

interface LspLocation {
  uri: string;
  range: LspRange;
}

interface ViewSync {
  path: string;
  session: Promise<LspDocSession> | null;
  opened: boolean;
  /** open 在途期间的变更:开完后补一次全量 didChange(LSP 版本不回退)。 */
  dirtyWhileOpening: boolean;
}

const viewSyncs = new WeakMap<EditorView, ViewSync>();
let activeView: EditorView | null = null;

/** F12:光标处符号跳定义。 */
export function gotoDefinitionAtCursor(): void {
  if (activeView) void symbolAction(activeView, activeView.state.selection.main.head, "definition");
}

/** Shift+F12:光标处符号引用 peek。 */
export function findReferencesAtCursor(): void {
  if (activeView) void symbolAction(activeView, activeView.state.selection.main.head, "references");
}

/** F12/Shift+F12 命令的 when 谓词:有 lsp 编辑器聚焦才吃键。 */
export function hasActiveEditor(): boolean {
  return activeView !== null;
}

function ensureSync(view: EditorView): Promise<LspDocSession> | null {
  const sync = viewSyncs.get(view);
  if (!sync) return null;
  if (!sync.session) {
    sync.session = (async () => {
      const session = await getSessionForPath(sync.path);
      if (!session) throw new Error("无语言服务配置");
      session.didOpen(sync.path, view.state.doc.toString());
      sync.opened = true;
      if (sync.dirtyWhileOpening) {
        sync.dirtyWhileOpening = false;
        session.didChange(sync.path, view.state.doc.toString(), []);
      }
      return session;
    })();
    sync.session.catch(() => {
      sync.session = null; // 失败不缓存:下次手势重试
    });
  }
  return sync.session;
}

/** Location | Location[] | LocationLink[] | null → 统一 {uri, range}[]。 */
function normalizeLocations(raw: unknown): LspLocation[] {
  const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: LspLocation[] = [];
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const loc = item as Record<string, unknown>;
    const uri =
      typeof loc.uri === "string" ? loc.uri : typeof loc.targetUri === "string" ? loc.targetUri : null;
    const rawRange = loc.range ?? loc.targetRange;
    if (uri && typeof rawRange === "object" && rawRange !== null) {
      out.push({ uri, range: rawRange as LspRange });
    }
  }
  return out;
}

function uriToPath(uri: string): string {
  return normalizePath(decodeURIComponent(uri.replace(/^file:\/\//, "")));
}

function locToPeekItem(loc: LspLocation): PeekItem {
  return { path: uriToPath(loc.uri), line: loc.range.start.line + 1 };
}

function rangeContainsOffset(range: LspRange, doc: string, offset: number): boolean {
  return lspToOffset(doc, range.start) <= offset && offset <= lspToOffset(doc, range.end);
}

/** hover.contents 的三种历史形态(MarkupContent / MarkedString[] / string)归一。 */
function hoverText(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  const h = raw as Record<string, unknown>;
  if (typeof h.value === "string") return h.value;
  if (Array.isArray(h.contents)) {
    const parts: string[] = [];
    for (const c of h.contents) {
      if (typeof c === "string") parts.push(c);
      else if (typeof c === "object" && c !== null && "value" in c && typeof (c as Record<string, unknown>).value === "string")
        parts.push((c as Record<string, unknown>).value as string);
    }
    return parts.length > 0 ? parts.join("\n\n") : null;
  }
  return null;
}

async function referencesPeek(
  view: EditorView,
  session: LspDocSession,
  path: string,
  doc: string,
  at: number,
): Promise<void> {
  showPeekLoading(view, at, "引用");
  const raw = await session.conn.request<unknown>(
    "textDocument/references",
    {
      textDocument: { uri: pathToUri(path) },
      position: offsetToLsp(doc, at),
      context: { includeDeclaration: true },
    },
    10_000,
  );
  const items = normalizeLocations(raw).map(locToPeekItem);
  showPeek(view, at, `引用 (${items.length})`, items);
}

async function symbolAction(view: EditorView, pos: number, mode: "definition" | "references"): Promise<void> {
  const sync = viewSyncs.get(view);
  if (!sync) return;
  activeView = view;
  const doc = view.state.doc.toString();
  const word = view.state.wordAt(pos);
  const at = word ? word.from : pos;
  try {
    const session = await ensureSync(view);
    if (!session) return;
    if (mode === "references") {
      await referencesPeek(view, session, sync.path, doc, at);
      return;
    }
    const raw = await session.conn.request<unknown>(
      "textDocument/definition",
      { textDocument: { uri: pathToUri(sync.path) }, position: offsetToLsp(doc, at) },
      5000,
    );
    const items = normalizeLocations(raw);
    if (items.length === 0) return;
    const currentUri = pathToUri(sync.path);
    if (items.some((it) => it.uri === currentUri && rangeContainsOffset(it.range, doc, at))) {
      await referencesPeek(view, session, sync.path, doc, at); // 点在定义上 → 引用 peek(截图同款)
      return;
    }
    if (items.length === 1) {
      const item = locToPeekItem(items[0]);
      openFileAtLine(item.path, item.line);
      return;
    }
    showPeek(view, at, `定义 (${items.length})`, items.map(locToPeekItem));
  } catch {
    /* server 未就绪/超时:静默降级(菜单态可见;不做猜测兜底)。 */
  }
}

/** lsp 编辑器扩展工厂(经 ctx.registerEditorExtension 注入)。 */
export const lspEditorExtension: EditorExtensionFactory = async ({ path }) => {
  if (!configForPath(path) || !owningWorkspaceRoot(path)) return null;
  const viewMod = await import("@codemirror/view");
  const { EditorView, ViewPlugin, hoverTooltip, keymap } = viewMod;

  const sync: ViewSync = { path, session: null, opened: false, dirtyWhileOpening: false };

  const updateSync = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    if (viewSyncs.get(update.view) !== sync) return;
    if (!sync.opened) {
      sync.dirtyWhileOpening = true;
      return;
    }
    const prevDoc = update.startState.doc.toString();
    const events: DocChangeEvent[] = [];
    update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      events.push({
        range: { start: offsetToLsp(prevDoc, fromA), end: offsetToLsp(prevDoc, toA) },
        rangeLength: toA - fromA,
        text: inserted.toString(),
      });
    });
    void sync.session?.then((session) => session.didChange(path, update.state.doc.toString(), events));
  });

  /* 视图生命周期:登记 sync 账本;销毁时对已打开文档补 didClose。 */
  const lifecycle = ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        viewSyncs.set(view, sync);
      }
      destroy() {
        if (sync.opened) void sync.session?.then((session) => session.didClose(path));
      }
    },
  );

  const handlers = EditorView.domEventHandlers({
    mousedown(event, view) {
      closePeekIfOutside(event.target);
      if (contextMenuOpen()) closeContextMenu();
      if (event.button !== 0) return false;
      if (!(event.metaKey || event.ctrlKey)) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      event.preventDefault();
      void symbolAction(view, pos, "definition");
      return true;
    },
    contextmenu(event, view) {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      event.preventDefault();
      openContextMenu(view, event.clientX, event.clientY, {
        definition: () => void symbolAction(view, pos, "definition"),
        references: () => void symbolAction(view, pos, "references"),
      });
      return true;
    },
    focusin(_event: FocusEvent, view: EditorView) {
      activeView = view;
    },
  });

  const hover = hoverTooltip(async (view, pos) => {
    const sync = viewSyncs.get(view);
    if (!sync) return null;
    try {
      const session = await ensureSync(view);
      if (!session) return null;
      const raw = await session.conn.request<unknown>(
        "textDocument/hover",
        { textDocument: { uri: pathToUri(sync.path) }, position: offsetToLsp(view.state.doc.toString(), pos) },
        5000,
      );
      const text = hoverText(raw);
      if (!text) return null;
      return {
        pos,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "lsp-hover";
          dom.textContent = text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
          return { dom };
        },
      };
    } catch {
      return null;
    }
  });

  /* Escape 关 peek/菜单:编辑器内局部键位,不经全局快捷键(Escape 永不注册)。 */
  const escapeKey = keymap.of([
    {
      key: "Escape",
      run: () => {
        const had = peekOpen() || contextMenuOpen();
        closePeek();
        closeContextMenu();
        return had;
      },
    },
  ]);

  return [updateSync, lifecycle, handlers, hover, escapeKey] as Extension[];
};
