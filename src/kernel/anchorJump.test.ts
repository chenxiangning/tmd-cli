/**
 * 锚点定位与跳转行为契约测试(anchorJump.ts)。
 * 覆盖:附件正文 needle、末次现行命中、写落定、翻页推进、快速连点与 active 追踪。
 * TerminalHandle 以纯数据 fake 实现;handle 注册表走真实 register/unregister。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  anchorNeedle,
  findAnchorRow,
  jumpToAnchor,
  jumpToText,
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
  loadEarlier?: (lines: string[]) => boolean | void | Promise<boolean | void>;
  settled?: (lines: string[]) => Promise<void>;
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
    settled: async () => { await opts.settled?.(state.lines); },
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
  it("首行附件与正文并存时剥 @token、折叠空白", () => {
    const a = anchor("1", "\n  @src/foo.ts 请帮我修复\n第二行");
    expect(anchorNeedle(a)).toBe("请帮我修复");
  });

  it("附件独占首行时继续找正文,不回退到相同路径前缀", () => {
    const a = anchor("1", "@/tmp/upload-a.png \n@/tmp/upload-b.png \n因子链路和口径关联,也需要动画效果");
    expect(anchorNeedle(a)).toBe("因子链路和口径关联,也需要动画效果");
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
  it("缺省取末次现行;文本互跳显式 occurrence 时仍取第 k 份", () => {
    const h = fakeHandle({ lines: ["needle here", "filler", "see needle here"] });
    expect(findAnchorRow(h, "needle")).toBe(2);
    expect(findAnchorRow(h, "needle", 1)).toBe(0);
    expect(findAnchorRow(h, "needle", 3)).toBeNull();
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
    const h = fakeHandle({ lines: ["only"], loadEarlier: () => false });
    current = h;
    registerTerminalHandle(sessionId, h);
    await expect(jumpToAnchor(sessionId, anchor("1", "never present"))).resolves.toBe(false);
    expect(scrollsOf(h)).toEqual([]);
  });

  it("翻页后 occurrence 不丢:同文第 2 条在翻入页里才凑齐,落第 2 条而非首条", async () => {
    /* 当前页只 1 处命中,occurrence=2 需翻页;翻入后 buffer 为
       [same text, pad×10, same text]:第 2 条在 row 11,留头 3 → 落 8。
       丢参退回 1 会落 row 0 → 0(回归钉:时间线 #N 深锚点定位错条)。 */
    const h = fakeHandle({
      lines: ["same text"],
      rows: 10,
      loadEarlier: (lines) => void lines.unshift("same text", ...Array.from({ length: 10 }, (_, i) => `pad ${i}`)),
    });
    current = h;
    registerTerminalHandle(sessionId, h);
    await expect(jumpToText(sessionId, "same text", 2)).resolves.toBe(true);
    expect(scrollsOf(h).at(-1)).toBe(8);
  });

  it("翻页换入新内容但行数不变仍继续定位(24K 上限)", async () => {
    const h = fakeHandle({
      lines: ["recent"],
      loadEarlier: (lines) => { lines.splice(0, lines.length, "old target"); return true; },
    });
    current = h;
    registerTerminalHandle(sessionId, h);
    await expect(jumpToAnchor(sessionId, anchor("1", "old target"))).resolves.toBe(true);
  });

  it("磁盘末条先到时等幕布写落定再搜索,不提前 miss", async () => {
    const h = fakeHandle({
      lines: ["old"],
      settled: async (lines) => { await Promise.resolve(); lines.push("last target"); },
    });
    current = h;
    registerTerminalHandle(sessionId, h);
    await expect(jumpToAnchor(sessionId, anchor("1", "last target"))).resolves.toBe(true);
  });

  it("幕布重建使 settled 拒绝时取消跳转,不搜索已销毁终端", async () => {
    const h = fakeHandle({ lines: ["target"], settled: () => Promise.reject(new Error("disposed")) });
    current = h;
    registerTerminalHandle(sessionId, h);
    await expect(jumpToAnchor(sessionId, anchor("1", "target"))).resolves.toBe(false);
    expect(scrollsOf(h)).toEqual([]);
  });

  it("快速首条到末条连点:慢前驱不得覆盖最后一次点击", async () => {
    const gate = Promise.withResolvers<void>();
    let calls = 0;
    const h = fakeHandle({
      lines: ["first target", ...Array.from({ length: 40 }, () => "pad"), "last target"],
      settled: () => ++calls === 1 ? gate.promise : Promise.resolve(),
    });
    current = h;
    registerTerminalHandle(sessionId, h);
    const first = jumpToAnchor(sessionId, anchor("1", "first target"));
    const last = jumpToAnchor(sessionId, anchor("2", "last target"));
    gate.resolve();
    await Promise.all([first, last]);
    expect(scrollsOf(h)).toEqual([38]);
  });

  it("在飞历史页未决时第二次点击等待重写,不被 scrollToTop 覆盖", async () => {
    const gate = Promise.withResolvers<void>();
    let loading: Promise<boolean | void> | undefined;
    const h = fakeHandle({
      lines: [...Array.from({ length: 40 }, () => "pad"), "last target"],
      settled: async () => { await loading; },
      loadEarlier: (lines) => {
        loading = (async () => {
          await gate.promise;
          lines.unshift("first target");
          h.scrollToLine(0);
          return true;
        })();
        return loading;
      },
    });
    current = h;
    registerTerminalHandle(sessionId, h);
    const first = jumpToAnchor(sessionId, anchor("1", "first target"));
    while (!loading) await Promise.resolve();
    const last = jumpToAnchor(sessionId, anchor("2", "last target"));
    gate.resolve();
    await Promise.all([first, last]);
    expect(scrollsOf(h)).toEqual([0, 38]);
  });

  it("原生滚动只有一次,最终行准确", async () => {
    const lines = Array.from({ length: 500 }, (_, i) => (i === 480 ? "deep unique target" : `pad ${i}`));
    const h = fakeHandle({ lines, rows: 30 });
    current = h;
    registerTerminalHandle(sessionId, h);
    await jumpToAnchor(sessionId, anchor("1", "deep unique target"));
    expect(scrollsOf(h)).toEqual([472]);
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
