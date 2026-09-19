/**
 * 锚点定位与跳转行为契约测试(anchorJump.ts)。
 * 覆盖:anchorNeedle(剥 @token、折叠空白、取首个非空行、截 24 字符、纯附件回退)、
 * findAnchorRow(自底向上、长 needle 优先、逐级退化到 8 字符、空 needle 拒绝)、
 * jumpToAnchor(无 handle 拒绝、28% 留头钳 0、翻页加载后命中、翻页无进展放弃、
 * 平滑滚动落点、并发跳转最新一帧赢)、resolveActiveAnchorId(参考线向上最近命中)。
 * TerminalHandle 以纯数据 fake 实现;handle 注册表走真实 register/unregister。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  anchorNeedle,
  findAnchorRow,
  jumpToAnchor,
  resolveActiveAnchorId,
} from "./anchorJump";
import {
  registerTerminalHandle,
  unregisterTerminalHandle,
  type TerminalHandle,
} from "./terminalHandles";
import type { UserMessageAnchor } from "./messageAnchors";

function anchor(id: string, text: string): UserMessageAnchor {
  return { id, text } as UserMessageAnchor;
}

function fakeHandle(opts: {
  lines: string[];
  viewportTop?: number;
  rows?: number;
  loadEarlier?: (lines: string[]) => void;
}): TerminalHandle {
  const state = { lines: [...opts.lines], scrolls: [] as number[] };
  const handle = {
    lineText: (row: number) => state.lines[row] ?? "",
    bufferLength: () => state.lines.length,
    viewportTop: () => opts.viewportTop ?? 0,
    rows: () => opts.rows ?? 10,
    scrollToLine: (row: number) => void state.scrolls.push(row),
    focus: () => {},
    onScroll: () => () => {},
    hasMoreHistory: () => opts.loadEarlier !== undefined,
    loadEarlier: async () => opts.loadEarlier?.(state.lines),
  } as unknown as TerminalHandle;
  Object.defineProperty(handle, "_state", { value: state });
  return handle;
}

const scrollsOf = (h: TerminalHandle): number[] =>
  (h as unknown as { _state: { scrolls: number[] } })._state.scrolls;

const sessionId = "s-test";
let current: TerminalHandle | undefined;

beforeEach(() => {
  current = undefined;
});

afterEach(() => {
  if (current) unregisterTerminalHandle(sessionId, current);
});

describe("anchorNeedle", () => {
  it("取首个非空行、剥 @token、折叠空白", () => {
    const a = anchor("1", "\n  @src/foo.ts 请帮我修复\n第二行");
    expect(anchorNeedle(a)).toBe("请帮我修复");
  });

  it("截断到 24 字符防长行", () => {
    const a = anchor("1", "x".repeat(40));
    expect(anchorNeedle(a)).toHaveLength(24);
  });

  it("纯附件消息剥空后回退原文首行", () => {
    const a = anchor("1", "@a.ts @b.ts");
    expect(anchorNeedle(a)).toBe("@a.ts @b.ts");
  });

  it("同一 anchor 对象重复取值稳定(缓存命中不变形)", () => {
    const a = anchor("1", "stable needle text");
    expect(anchorNeedle(a)).toBe(anchorNeedle(a));
  });
});

describe("findAnchorRow", () => {
  it("自底向上返回最后一处命中行", () => {
    const h = fakeHandle({ lines: ["needle here", "filler", "see needle here"] });
    expect(findAnchorRow(h, "needle")).toBe(2);
  });

  it("长 needle 不命中时逐级退化到短 needle(8 字符档命中)", () => {
    const h = fakeHandle({ lines: ["filler", "xx short prefix"] });
    expect(findAnchorRow(h, "short prefix only-in-anchor")).toBe(1);
  });

  it("空 needle 与全不命中返回 null", () => {
    const h = fakeHandle({ lines: ["a"] });
    expect(findAnchorRow(h, "")).toBeNull();
    expect(findAnchorRow(h, "missing")).toBeNull();
  });
});

describe("jumpToAnchor", () => {
  it("无注册 handle 时返回 false", async () => {
    await expect(jumpToAnchor("no-such", anchor("1", "text"))).resolves.toBe(false);
  });

  it("命中后按 28% 留头跳转并返回 true(10 行视口 → 目标行 7)", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => (i === 10 ? "unique target line" : `pad ${i}`));
    const h = fakeHandle({ lines, rows: 10 });
    current = h;
    registerTerminalHandle(sessionId, h);
    await expect(jumpToAnchor(sessionId, anchor("1", "unique target line"))).resolves.toBe(true);
    expect(scrollsOf(h).at(-1)).toBe(7);
  });

  it("留头钳 0:目标行过浅时不滚成负数", async () => {
    const h = fakeHandle({ lines: ["top needle", "pad"], rows: 10 });
    current = h;
    registerTerminalHandle(sessionId, h);
    await expect(jumpToAnchor(sessionId, anchor("1", "top needle"))).resolves.toBe(true);
    expect(scrollsOf(h).at(-1)).toBe(0);
  });

  it("消息不在 buffer 时逐页加载历史后命中", async () => {
    const h = fakeHandle({
      lines: ["recent output"],
      rows: 10,
      loadEarlier: (lines) => void lines.unshift("old needle page"),
    });
    current = h;
    registerTerminalHandle(sessionId, h);
    await expect(jumpToAnchor(sessionId, anchor("1", "old needle page"))).resolves.toBe(true);
    expect(scrollsOf(h).at(-1)).toBe(0);
  });

  it("翻页无进展(加载空页)即放弃返回 false,不空转", async () => {
    const h = fakeHandle({ lines: ["only"], loadEarlier: () => {} });
    current = h;
    registerTerminalHandle(sessionId, h);
    await expect(jumpToAnchor(sessionId, anchor("1", "never present"))).resolves.toBe(false);
    expect(scrollsOf(h)).toEqual([]);
  });

  it("平滑滚动落点为逐帧插值的最终目标行(500 行 buffer,目标 472)", async () => {
    const lines = Array.from({ length: 500 }, (_, i) => (i === 480 ? "deep unique target" : `pad ${i}`));
    const h = fakeHandle({ lines, rows: 30 });
    current = h;
    registerTerminalHandle(sessionId, h);
    await jumpToAnchor(sessionId, anchor("1", "deep unique target"));
    expect(scrollsOf(h).at(-1)).toBe(472);
  });

  it("并发跳转最新一帧赢:旧动画让位后落点是新目标", async () => {
    const lines = Array.from({ length: 300 }, (_, i) =>
      i === 250 ? "alpha unique" : i === 100 ? "beta unique" : `pad ${i}`,
    );
    const h = fakeHandle({ lines, rows: 30 });
    current = h;
    registerTerminalHandle(sessionId, h);
    const first = jumpToAnchor(sessionId, anchor("a", "alpha unique"));
    const second = jumpToAnchor(sessionId, anchor("b", "beta unique"));
    await Promise.all([first, second]);
    expect(scrollsOf(h).at(-1)).toBe(92); /* 100 - round(30*0.28) */
  });
});

describe("resolveActiveAnchorId", () => {
  it("参考线(视口顶 + min(6, 32% 行数))向上找最近一条锚点", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `pad ${i}`);
    lines[110] = "alpha message line";
    lines[103] = "beta message line"; /* 参考线恰在此,自身即候选 */
    const h = fakeHandle({ lines, viewportTop: 100, rows: 10 });
    const id = resolveActiveAnchorId(h, [anchor("a", "alpha message line"), anchor("b", "beta message line")]);
    expect(id).toBe("b");
  });

  it("参考线附近无锚点继续向上走命中更早消息;全无命中返回 null", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `pad ${i}`);
    lines[20] = "early message line";
    const h = fakeHandle({ lines, viewportTop: 150, rows: 10 });
    expect(resolveActiveAnchorId(h, [anchor("a", "early message line")])).toBe("a");
    expect(resolveActiveAnchorId(h, [anchor("z", "totally absent text")])).toBeNull();
  });

  it("空锚点集返回 null", () => {
    const h = fakeHandle({ lines: ["x"] });
    expect(resolveActiveAnchorId(h, [])).toBeNull();
  });
});
