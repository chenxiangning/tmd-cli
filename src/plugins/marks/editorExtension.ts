/**
 * marks 的 CodeMirror 扩展工厂 —— 行间锚点装饰 + 选区落标 + reveal 定位。
 *
 * 装饰面:标记行底色(待发送琥珀 / 已发送蓝)+ 行末批注 widget(默认折叠
 * 一行摘要条,点开成批注卡);选区非空时浮「⚑ 标记」按钮,点击把选区行落锚。
 * 定位面:消费 store.reveal(面板「定位」/ 终端回链共用)→ 滚动 + 行闪烁。
 *
 * 拆包红线(council 裁决):对 @codemirror/* 只 type-only;运行期一律动态
 * import —— 静态 import 会把 CM 全家桶经 allPlugins 静态图拖回主 chunk,
 * 击穿「未开代码文件首屏零加载」(先例:kernel/cmEditor/cmTheme.ts)。
 * widget 类定义见 ./widgets.ts(CM 运行时类经参数注入)。
 */

import type { Extension } from "@codemirror/state";
import type { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import type { EditorExtensionFactory } from "@kernel/editorExtensions";
import { getActiveWorkspace } from "@kernel/workspace";
import { createMarkWidgets, type MarkRuntime } from "./widgets";
import {
  marksSnapshot,
  relocatePath,
  subscribeMarks,
  takeReveal,
} from "./store";

function cwdRoot(): string | null {
  return getActiveWorkspace()?.root ?? null;
}

export const marksEditorExtension: EditorExtensionFactory = async ({ path }) => {
  const [{ StateEffect, StateField, RangeSetBuilder }, { Decoration, EditorView, ViewPlugin, WidgetType }] =
    await Promise.all([import("@codemirror/state"), import("@codemirror/view")]);
  const { NoteWidget, AddMarkWidget } = createMarkWidgets({ WidgetType });

  const setMarksEffect = StateEffect.define<readonly MarkRuntime[]>();
  const setSelEffect = StateEffect.define<{ from: number; to: number } | null>();
  const flashEffect = StateEffect.define<number | null>();

  const runtimeMarks = (): readonly MarkRuntime[] => {
    const snap = marksSnapshot();
    const cwd = cwdRoot();
    const all = cwd ? (snap.byCwd[cwd] ?? []) : [];
    const expanded = new Set(snap.expandedIds);
    return all
      .filter((mark) => mark.path === path)
      .map((mark) => ({
        id: mark.id,
        startLine: mark.startLine,
        endLine: mark.endLine,
        state: mark.state,
        note: mark.note,
        expanded: expanded.has(mark.id),
      }));
  };

  const marksField = StateField.define<readonly MarkRuntime[]>({
    create: runtimeMarks,
    update(value, tr) {
      let next = value;
      for (const effect of tr.effects) {
        if (effect.is(setMarksEffect)) next = effect.value;
      }
      return next;
    },
  });
  const selField = StateField.define<{ from: number; to: number } | null>({
    create: () => null,
    update(value, tr) {
      let next = value;
      for (const effect of tr.effects) {
        if (effect.is(setSelEffect)) next = effect.value;
      }
      return next;
    },
  });
  const flashField = StateField.define<number | null>({
    create: () => null,
    update(value, tr) {
      let next = value;
      for (const effect of tr.effects) {
        if (effect.is(flashEffect)) next = effect.value;
      }
      return next;
    },
  });

  function buildDecorations(view: EditorView): DecorationSet {
    const doc = view.state.doc;
    const entries: { pos: number; deco: Decoration }[] = [];
    for (const mark of view.state.field(marksField)) {
      const start = Math.min(Math.max(mark.startLine, 1), doc.lines);
      const end = Math.min(Math.max(mark.endLine, start), doc.lines);
      const deco = Decoration.line({
        class: mark.state === "sent" ? "marks-line-sent" : "marks-line-pending",
      });
      for (let lineNo = start; lineNo <= end; lineNo++) {
        entries.push({ pos: doc.line(lineNo).from, deco });
      }
      entries.push({
        pos: doc.line(end).to,
        deco: Decoration.widget({ widget: new NoteWidget(mark), side: 1 }),
      });
    }
    const flashLine = view.state.field(flashField);
    if (flashLine !== null && flashLine >= 1 && flashLine <= doc.lines) {
      entries.push({ pos: doc.line(flashLine).from, deco: Decoration.line({ class: "marks-line-flash" }) });
    }
    const sel = view.state.field(selField);
    if (sel) {
      entries.push({
        pos: sel.from,
        deco: Decoration.widget({ widget: new AddMarkWidget(sel.from, sel.to, view, path), side: 1 }),
      });
    }
    entries.sort((a, b) => a.pos - b.pos);
    const builder = new RangeSetBuilder<Decoration>();
    for (const entry of entries) builder.add(entry.pos, entry.pos, entry.deco);
    return builder.finish();
  }

  /* 装饰 + store 桥合一:装饰纯派生自三个 field;订阅把 store 变化推进 field,
     并消费 reveal(滚动+闪烁)。doc 变更防抖触发指纹重定位。 */
  const marksPlugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private relocateTimer: ReturnType<typeof setTimeout> | undefined;

      constructor(readonly view: EditorView) {
        this.decorations = buildDecorations(view);
        this.scheduleRelocate();
        this.unsubscribe = subscribeMarks(() => {
          view.dispatch({ effects: setMarksEffect.of(runtimeMarks()) });
          this.reveal();
        });
        queueMicrotask(() => this.reveal());
      }
      private unsubscribe: () => void = () => undefined;

      private scheduleRelocate(): void {
        clearTimeout(this.relocateTimer);
        this.relocateTimer = setTimeout(() => {
          const cwd = cwdRoot();
          if (cwd) relocatePath(cwd, path, this.view.state.doc.toString().split("\n"));
        }, 500);
      }

      private reveal(): void {
        const reveal = takeReveal(path);
        if (!reveal) return;
        const lineNo = Math.min(Math.max(reveal.line, 1), this.view.state.doc.lines);
        const pos = this.view.state.doc.line(lineNo).from;
        this.view.dispatch({
          effects: [EditorView.scrollIntoView(pos, { y: "center" }), flashEffect.of(lineNo)],
        });
        setTimeout(() => this.view.dispatch({ effects: flashEffect.of(null) }), 1200);
      }

      update(update: { docChanged: boolean; startState: EditorView["state"]; state: EditorView["state"] }): void {
        const fieldsChanged =
          update.startState.field(marksField) !== update.state.field(marksField) ||
          update.startState.field(selField) !== update.state.field(selField) ||
          update.startState.field(flashField) !== update.state.field(flashField);
        if (update.docChanged || fieldsChanged) {
          this.decorations = buildDecorations(this.view);
          if (update.docChanged) this.scheduleRelocate();
        }
      }

      destroy(): void {
        this.unsubscribe();
        clearTimeout(this.relocateTimer);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );

  const selWatcher = EditorView.updateListener.of((update) => {
    if (!update.selectionSet) return;
    const range = update.state.selection.main;
    const prev = update.startState.field(selField);
    const next = range.empty ? null : { from: range.from, to: range.to };
    if (prev?.from !== next?.from || prev?.to !== next?.to) {
      update.view.dispatch({ effects: setSelEffect.of(next) });
    }
  });

  return [
    marksField,
    selField,
    flashField,
    /* 行装饰样式:待发送琥珀 / 已发送蓝 / 闪烁定位(随主题 token 明暗自适应)。
       .marks-inline 必须 white-space:normal —— widget 植在 .cm-line 内会继承
       pre,模板里标签间的换行缩进会按字面渲染撑破卡片。 */
    EditorView.theme({
      ".marks-line-pending": {
        backgroundColor: "rgba(234,179,8,0.10)",
        boxShadow: "inset 2px 0 0 var(--tmd-warn)",
      },
      ".marks-line-sent": {
        backgroundColor: "var(--tmd-accent-soft)",
        boxShadow: "inset 2px 0 0 var(--tmd-accent)",
      },
      ".marks-line-flash": { backgroundColor: "var(--tmd-accent-soft)" },
      ".marks-inline": {
        fontFamily: "inherit",
        whiteSpace: "normal",
        textWrap: "wrap",
      },
    }),
    marksPlugin,
    selWatcher,
  ] satisfies Extension[];
};
