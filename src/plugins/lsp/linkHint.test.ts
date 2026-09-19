/**
 * cmd/ctrl+hover 链接态预告测试 —— createLinkHint 契约清单:
 * 1. meta/ctrl + mousemove:词区间 dispatch setHint;同词重复悬停不重复 dispatch(幂等)
 * 2. 无修饰键 mousemove、mouseleave、keyup(Meta|Control)、修饰键 mousedown → 清除(null)
 * 3. mouseleave 遗忘最近坐标:此后 keydown Meta 不再出预告
 * 4. keydown Meta/Control 用最近一次鼠标坐标出预告(按下后鼠标未动也要立刻出)
 * 5. posAtCoords 无命中或当前位置无词 → 清除而非崩溃;初始清除态不空发 dispatch
 *
 * 模块红线:CM 模块由参数注入(node 无 DOM 无真实 EditorView),手写最小 fake 承接。
 */
import { describe, expect, it } from "vitest";

import { createLinkHint } from "./linkHint";

type Effect = { is(tag: unknown): boolean; value: unknown };
type Dispatch = { effects: Effect[] };
type Handler = (event: Record<string, unknown>, view: unknown) => void;

/** 最小 fake CM 模块:StateEffect.define 用身份 tag 判 is;StateField 只回收 spec。 */
function fakeMods() {
  const Decoration = {
    mark: (spec: Record<string, unknown>) => ({
      spec,
      range: (from: number, to: number) => ({ from, to, spec }),
    }),
    none: { none: true },
    set: (ranges: unknown[]) => ({ ranges }),
  };
  const EditorView = {
    domEventHandlers: (handlers: Record<string, Handler>) => handlers,
    decorations: { from: () => null },
  };
  const StateEffect = {
    define: () => {
      const tag = {};
      return { of: (value: unknown): Effect => ({ is: (t: unknown) => t === tag, value }) };
    },
  };
  const StateField = { define: (spec: unknown) => ({ spec }) };
  return { viewMod: { Decoration, EditorView }, stateMod: { StateEffect, StateField } };
}

const buildHandlers = (): Record<string, Handler> => {
  const mods = fakeMods();
  const ext = (createLinkHint as (v: unknown, s: unknown) => unknown[])(mods.viewMod, mods.stateMod);
  return ext[1] as Record<string, Handler>;
};

/** fake 视图:坐标→位置与词区间由测试驱动,dispatch 全量留痕。 */
function makeView() {
  const dispatched: Dispatch[] = [];
  const cfg = { pos: null as number | null, word: null as { from: number; to: number } | null };
  return {
    dispatched,
    cfg,
    posAtCoords: () => cfg.pos,
    state: { wordAt: () => cfg.word },
    dispatch(tr: Dispatch) {
      /* CM dispatch 的 effects 允许单值,归一成数组便于断言。 */
      const fx = Array.isArray(tr.effects) ? tr.effects : [tr.effects];
      dispatched.push({ effects: fx });
    },
  };
}
const hintValue = (tr: Dispatch) => tr.effects[0].value;

describe("预告状态机", () => {
  it("meta+mousemove 出词区间预告;同词重复悬停不重复 dispatch", () => {
    const view = makeView();
    const h = buildHandlers();
    view.cfg.pos = 5;
    view.cfg.word = { from: 3, to: 8 };
    h.mousemove({ metaKey: true, clientX: 10, clientY: 10 }, view);
    expect(view.dispatched.length).toBe(1);
    expect(hintValue(view.dispatched[0])).toEqual({ from: 3, to: 8 });
    h.mousemove({ metaKey: true, clientX: 11, clientY: 10 }, view);
    expect(view.dispatched.length).toBe(1);
  });

  it("ctrl 键与 meta 等价", () => {
    const view = makeView();
    const h = buildHandlers();
    view.cfg.pos = 5;
    view.cfg.word = { from: 3, to: 8 };
    h.mousemove({ ctrlKey: true, clientX: 10, clientY: 10 }, view);
    expect(view.dispatched.length).toBe(1);
    expect(hintValue(view.dispatched[0])).toEqual({ from: 3, to: 8 });
  });

  it("无修饰键 mousemove 清除;清除态下再移不空发 dispatch", () => {
    const view = makeView();
    const h = buildHandlers();
    view.cfg.pos = 5;
    view.cfg.word = { from: 3, to: 8 };
    h.mousemove({ metaKey: true, clientX: 10, clientY: 10 }, view);
    h.mousemove({ clientX: 10, clientY: 10 }, view);
    expect(view.dispatched.length).toBe(2);
    expect(hintValue(view.dispatched[1])).toBeNull();
    h.mousemove({ clientX: 12, clientY: 10 }, view);
    expect(view.dispatched.length).toBe(2);
  });

  it("keydown Meta 用最近鼠标坐标出预告;keyup 清除", () => {
    const view = makeView();
    const h = buildHandlers();
    view.cfg.pos = 5;
    view.cfg.word = { from: 3, to: 8 };
    h.mousemove({ clientX: 42, clientY: 7 }, view); // 无修饰且初始已清除:不 dispatch
    expect(view.dispatched.length).toBe(0);
    h.keydown({ key: "Meta" }, view); // 按住后鼠标未动也立刻出预告
    expect(view.dispatched.length).toBe(1);
    expect(hintValue(view.dispatched[0])).toEqual({ from: 3, to: 8 });
    h.keyup({ key: "Meta" }, view);
    expect(view.dispatched.length).toBe(2);
    expect(hintValue(view.dispatched[1])).toBeNull();
  });

  it("mouseleave 清除并遗忘坐标,此后 keydown Meta 不再出预告", () => {
    const view = makeView();
    const h = buildHandlers();
    view.cfg.pos = 5;
    view.cfg.word = { from: 3, to: 8 };
    h.mousemove({ metaKey: true, clientX: 10, clientY: 10 }, view);
    h.mouseleave({}, view);
    expect(view.dispatched.length).toBe(2);
    expect(hintValue(view.dispatched[1])).toBeNull();
    h.keydown({ key: "Control" }, view);
    expect(view.dispatched.length).toBe(2);
  });

  it("修饰键 mousedown 撤预告(跳转裁决期不放提示)", () => {
    const view = makeView();
    const h = buildHandlers();
    view.cfg.pos = 5;
    view.cfg.word = { from: 3, to: 8 };
    h.mousemove({ metaKey: true, clientX: 10, clientY: 10 }, view);
    expect(view.dispatched.length).toBe(1);
    h.mousedown({ metaKey: true }, view);
    expect(view.dispatched.length).toBe(2);
    expect(hintValue(view.dispatched[1])).toBeNull();
  });

  it("坐标无命中或无词时清除而非崩溃;初始清除态不空发 dispatch", () => {
    const view = makeView();
    const h = buildHandlers();
    h.mousemove({ metaKey: true, clientX: 1, clientY: 1 }, view);
    expect(view.dispatched.length).toBe(0); // 初始即清除态,幂等不 dispatch
    view.cfg.pos = 4;
    view.cfg.word = { from: 1, to: 6 };
    h.mousemove({ metaKey: true, clientX: 1, clientY: 1 }, view);
    expect(view.dispatched.length).toBe(1);
    view.cfg.word = null; // 移到词外
    h.mousemove({ metaKey: true, clientX: 2, clientY: 2 }, view);
    expect(view.dispatched.length).toBe(2);
    expect(hintValue(view.dispatched[1])).toBeNull();
  });
});
