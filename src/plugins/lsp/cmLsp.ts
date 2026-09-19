/**
 * lsp 的 CodeMirror 扩展工厂 —— 手势/hover/文档同步/键位桥。
 *
 * 拆包红线(architecture/13):@codemirror/* 运行期一律动态 import。
 * 惰性:文件打开不拉 server,首个语义动作(手势/键位/命令/hover)才
 * ensureSync(spawn+initialize+didOpen);此后增量 didChange 同步。
 * 语义路由(spec):cmd/ctrl+click → definition;单目标直跳,definition
 * 结果包含点击位置(=点在定义上)或多目标 → 引用/列表 peek;Shift+F12 →
 * references peek(含声明);F12 → definition 同手势。
 * 二轮:seq 序号牌防陈旧覆盖、dead conn 弃缓存自愈(sessionStateForPath)、
 * 250ms 延迟 loading、cmd+hover 链接态(linkHint)、hover markdown 渲染(hoverCard)。
 * 位置换算管道(normalizeLocations/locToPeekItem 等)在 lspLocations.ts。
 */

import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { EditorExtensionFactory } from "@kernel/editorExtensions";
import { configForPath, owningWorkspaceRoot } from "@kernel/lsp/lspRegistry";
import { offsetToLsp } from "@kernel/lsp/lspPosition";
import { t } from "@kernel/i18n";
import { openFileAtLine } from "@kernel/fileTabs";
import { closeContextMenu, closeContextMenuIfOwner, contextMenuOpen, openContextMenu } from "./contextMenu";
import { closePeek, closePeekIfOwner, peekOpen, showPeek, showPeekLoading } from "./peekWidget";
import {
  getSessionForPath,
  pathToUri,
  sessionStateForPath,
  type DocChangeEvent,
  type LspDocSession,
} from "./session";
import { createLinkHint } from "./linkHint";
import { hoverMarkdown, renderHoverCard } from "./hoverCard";
import { locToPeekItem, normalizeLocations, rangeContainsOffset } from "./lspLocations";

interface ViewSync {
  path: string;
  session: Promise<LspDocSession> | null;
  opened: boolean;
  /** open 在途期间的变更:开完后补一次全量 didChange(LSP 版本不回退)。 */
  dirtyWhileOpening: boolean;
}

const viewSyncs = new WeakMap<EditorView, ViewSync>();
let activeView: EditorView | null = null;
/* 语义动作序号牌:连续触发时旧请求结果一律作废(防慢响应覆盖新 peek)。 */
let actionSeq = 0;

/** F12:光标处符号跳定义。 */
export function gotoDefinitionAtCursor(): void {
  if (activeView) void symbolAction(activeView, activeView.state.selection.main.head, "definition");
}

/** Shift+F12:光标处符号引用 peek。 */
export function findReferencesAtCursor(): void {
  if (activeView) void symbolAction(activeView, activeView.state.selection.main.head, "references");
}

/** F12/Shift+F12 命令的 when 谓词:lsp 编辑器持真实焦点才吃键(终端聚焦穿透进 PTY)。 */
export function hasActiveEditor(): boolean {
  return activeView !== null && activeView.dom.contains(document.activeElement);
}

function ensureSync(view: EditorView): Promise<LspDocSession> | null {
  const sync = viewSyncs.get(view);
  if (!sync) return null;
  /* 连接已死(idle 关停/进程退出,state=none):弃缓存重建;opening 在途共享保留。 */
  if (sync.session && sessionStateForPath(sync.path) === "none") {
    sync.session = null;
    sync.opened = false;
  }
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

/** 延迟 loading:250ms 内返回不上屏(快 server 不闪);超时未回才 showPeekLoading。 */
function delayedLoading(view: EditorView, at: number, title: string): () => void {
  const timer = setTimeout(() => showPeekLoading(view, at, title), 250);
  return () => clearTimeout(timer);
}

async function referencesPeek(
  view: EditorView,
  session: LspDocSession,
  path: string,
  doc: string,
  at: number,
  isStale: () => boolean,
): Promise<void> {
  const raw = await session.conn.request<unknown>(
    "textDocument/references",
    {
      textDocument: { uri: pathToUri(path) },
      position: offsetToLsp(doc, at),
      context: { includeDeclaration: true },
    },
    10_000,
  );
  if (isStale()) return;
  const items = normalizeLocations(raw).map(locToPeekItem);
  showPeek(view, at, `${t("引用")} (${items.length})`, items);
}

async function symbolAction(view: EditorView, pos: number, mode: "definition" | "references"): Promise<void> {
  const sync = viewSyncs.get(view);
  if (!sync) return;
  activeView = view;
  const seq = ++actionSeq;
  const isStale = () => seq !== actionSeq;
  const doc = view.state.doc.toString();
  const word = view.state.wordAt(pos);
  const at = word ? word.from : pos;
  const cancelLoading = delayedLoading(view, at, mode === "references" ? t("引用") : t("定义"));
  try {
    const session = await ensureSync(view);
    if (!session || isStale()) return;
    if (mode === "references") {
      await referencesPeek(view, session, sync.path, doc, at, isStale);
      return;
    }
    const raw = await session.conn.request<unknown>(
      "textDocument/definition",
      { textDocument: { uri: pathToUri(sync.path) }, position: offsetToLsp(doc, at) },
      5000,
    );
    if (isStale()) return;
    const items = normalizeLocations(raw);
    if (items.length === 0) {
      closePeek(); // 慢 server 已上 loading 时收回;未上屏 noop
      return;
    }
    const currentUri = pathToUri(sync.path);
    if (items.some((it) => it.uri === currentUri && rangeContainsOffset(it.range, doc, at))) {
      await referencesPeek(view, session, sync.path, doc, at, isStale); // 点在定义上 → 引用 peek(截图同款)
      return;
    }
    if (items.length === 1) {
      const item = locToPeekItem(items[0]);
      closePeek();
      openFileAtLine(item.path, item.line);
      return;
    }
    showPeek(view, at, `${t("定义")} (${items.length})`, items.map(locToPeekItem));
  } catch {
    /* server 未就绪/超时:静默降级(菜单态可见;不做猜测兜底),收 loading。 */
    if (!isStale()) closePeek();
  } finally {
    cancelLoading();
  }
}

/** lsp 编辑器扩展工厂(经 ctx.registerEditorExtension 注入)。 */
export const lspEditorExtension: EditorExtensionFactory = async ({ path }) => {
  if (!configForPath(path) || !owningWorkspaceRoot(path)) return null;
  const [viewMod, stateMod] = await Promise.all([import("@codemirror/view"), import("@codemirror/state")]);
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

  /* 视图生命周期:登记 sync 账本;销毁时对已打开文档补 didClose + 收浮层。 */
  const lifecycle = ViewPlugin.fromClass(
    class {
      private view: EditorView;
      constructor(view: EditorView) {
        this.view = view;
        viewSyncs.set(view, sync);
      }
      destroy() {
        if (sync.opened) void sync.session?.then((session) => session.didClose(path));
        closePeekIfOwner(this.view);
        closeContextMenuIfOwner(this.view);
        if (activeView === this.view) activeView = null;
      }
    },
  );

  const handlers = EditorView.domEventHandlers({
    mousedown(event, view) {
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
      if (!view.state.wordAt(pos)) return false; // 空白处不弹(动作必空)
      event.preventDefault();
      openContextMenu(view, event.clientX, event.clientY, {
        serverState: sessionStateForPath(path) ?? "none",
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
      const markdown = hoverMarkdown(raw);
      if (!markdown) return null;
      return {
        pos,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "lsp-hover";
          renderHoverCard(dom, markdown);
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

  const linkHint = createLinkHint(viewMod, stateMod);

  return [linkHint, updateSync, lifecycle, handlers, hover, escapeKey] as Extension[];
};
