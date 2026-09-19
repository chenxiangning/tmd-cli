/**
 * cmd/ctrl+hover 链接态预告 —— 按住 meta||ctrl 悬停时词下划线+手型
 *(VS Code 同款可发现性反馈)。词法级(wordAt),零 server 调用;
 * 是否真可跳由 mousedown 的 definition 请求裁决。
 * 拆包红线:@codemirror/* 由 cmLsp 动态 import 后注入,此文件不直接运行期 import。
 */

import type { Extension, Transaction } from "@codemirror/state";
import type { DecorationSet, EditorView } from "@codemirror/view";
import type * as StateNS from "@codemirror/state";
import type * as ViewNS from "@codemirror/view";

type StateMod = typeof StateNS;
type ViewMod = typeof ViewNS;
export function createLinkHint(viewMod: ViewMod, stateMod: StateMod): Extension {
  const { Decoration, EditorView } = viewMod;
  const { StateEffect, StateField } = stateMod;
  const linkMark = Decoration.mark({ class: "lsp-link-hint" });

  const setHint = StateEffect.define<{ from: number; to: number } | null>();
  const hintField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco: DecorationSet, tr: Transaction) {
      for (const effect of tr.effects) {
        if (effect.is(setHint)) {
          return effect.value
            ? Decoration.set([linkMark.range(effect.value.from, effect.value.to)])
            : Decoration.none;
        }
      }
      return deco.map(tr.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  /* 最近鼠标坐标:Meta/Ctrl keydown 时鼠标未动也要立刻出预告(VS Code 同)。 */
  let lastCoords: { x: number; y: number } | null = null;
  let current: { from: number; to: number } | null = null;

  const apply = (view: EditorView, range: { from: number; to: number } | null) => {
    if (range?.from === current?.from && range?.to === current?.to) return;
    current = range;
    view.dispatch({ effects: setHint.of(range) });
  };
  const hintAt = (view: EditorView, x: number, y: number) => {
    const pos = view.posAtCoords({ x, y });
    const word = pos == null ? null : view.state.wordAt(pos);
    apply(view, word ? { from: word.from, to: word.to } : null);
  };

  const handlers = EditorView.domEventHandlers({
    mousemove(event, view) {
      lastCoords = { x: event.clientX, y: event.clientY };
      if (event.metaKey || event.ctrlKey) hintAt(view, event.clientX, event.clientY);
      else apply(view, null);
    },
    mouseleave(_event, view) {
      lastCoords = null;
      apply(view, null);
    },
    keydown(event, view) {
      if ((event.key === "Meta" || event.key === "Control") && lastCoords) {
        hintAt(view, lastCoords.x, lastCoords.y);
      }
    },
    keyup(event, view) {
      if (event.key === "Meta" || event.key === "Control") apply(view, null);
    },
    mousedown(event, view) {
      if (event.metaKey || event.ctrlKey) apply(view, null);
    },
  });

  return [hintField, handlers];
}
