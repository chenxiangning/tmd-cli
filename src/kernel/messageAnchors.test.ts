/**
 * 对话锚点定位/跳转逻辑测试 —— fake TerminalHandle 直驱,不依赖 xterm。
 * 契约:
 * - anchorNeedle:剥 @附件 token、折叠空白、首行 24 字符;
 * - findAnchorRow:自底向上,长 needle 优先、逐级退化;
 * - jumpToAnchor:28% 留头;消息太老时翻页加载再试,无进展/超页限放弃;
 * - resolveActiveAnchorId:视口参考线向上取最近锚点。
 */

import { describe, expect, it, vi } from "vitest";

/* host 经 ipc 触达 Tauri;本测试只测纯逻辑,Mock 掉 ipc 即可(import 期无副作用)。 */
vi.mock("./ipc", () => ({
  ipc: {},
}));

import {
  anchorNeedle,
  findAnchorRow,
  jumpToAnchor,
  registerTerminalHandle,
  resolveActiveAnchorId,
  unregisterTerminalHandle,
  type TerminalHandle,
  type UserMessageAnchor,
} from "./messageAnchors";

function fakeHandle(lines: string[], opts?: { viewportTop?: number; rows?: number }) {
  const state = {
    scrollTo: -1,
    viewportTop: opts?.viewportTop ?? 0,
    rows: opts?.rows ?? 50,
    pages: [] as string[][],
  };
  const handle: TerminalHandle = {
    lineText: (row) => lines[row] ?? "",
    bufferLength: () => lines.length,
    viewportTop: () => state.viewportTop,
    rows: () => state.rows,
    scrollToLine: (row) => {
      state.scrollTo = row;
    },
    focus: () => {},
    onScroll: () => () => {},
    hasMoreHistory: () => state.pages.length > 0,
    loadEarlier: async () => {
      const page = state.pages.shift();
      if (page) lines.unshift(...page);
    },
  };
  return { handle, state };
}

const anchor = (id: string, text: string): UserMessageAnchor => ({ id, text });

describe("anchorNeedle", () => {
  it("折叠空白取首行 24 字符", () => {
    expect(anchorNeedle(anchor("1", "  帮我  把列表\n做成可配置的"))).toBe("帮我 把列表");
  });

  it("剥掉 composer 注入的 @附件 token", () => {
    expect(anchorNeedle(anchor("2", "@/tmp/upload-1.png 请问这个图"))).toBe("请问这个图");
  });

  it("纯附件消息剥空后回退原文", () => {
    expect(anchorNeedle(anchor("3", "@/tmp/upload-1.png"))).toBe("@/tmp/upload-1.png");
  });
});

describe("findAnchorRow", () => {
  it("自底向上命中最后一次出现(重复提问跳最新)", () => {
    const { handle } = fakeHandle(["同一句话", "中间回复", "同一句话"]);
    expect(findAnchorRow(handle, "同一句话")).toBe(2);
  });

  it("长 needle 被气泡截断时退化短 needle 命中", () => {
    /* 幕布行只显示前 10 字符:24 字符 needle 不配,14/8 字符梯队命中 */
    const text = "这是一条很长很长的用户消息需要截断处理";
    const { handle } = fakeHandle([text.slice(0, 10)]);
    expect(findAnchorRow(handle, anchorNeedle(anchor("1", text)))).toBe(0);
  });

  it("找不到返回 null", () => {
    const { handle } = fakeHandle(["别的内容"]);
    expect(findAnchorRow(handle, "不存在的消息")).toBeNull();
  });
});

describe("jumpToAnchor", () => {
  it("命中即跳:28% 留头,顶部收敛到 0", () => {
    const lines = Array.from({ length: 100 }, (_, i) => (i === 40 ? "目标消息行" : `填充 ${i}`));
    const { handle, state } = fakeHandle(lines, { rows: 50 });
    registerTerminalHandle("s1", handle);
    return jumpToAnchor("s1", anchor("1", "目标消息行")).then((ok) => {
      expect(ok).toBe(true);
      /* 40 - round(50 * 0.28) = 26 */
      expect(state.scrollTo).toBe(26);
      unregisterTerminalHandle("s1", handle);
    });
  });

  it("消息不在 buffer 时翻页加载后命中", async () => {
    const lines = ["近期输出"];
    const { handle, state } = fakeHandle(lines, { rows: 10 });
    state.pages.push(["很老的消息"], ["更早的页"]);
    registerTerminalHandle("s2", handle);
    const ok = await jumpToAnchor("s2", anchor("1", "很老的消息"));
    expect(ok).toBe(true);
    expect(state.scrollTo).toBe(0); /* row 0,留头收敛 */
    unregisterTerminalHandle("s2", handle);
  });

  it("翻页无进展立即放弃;无历史返回 false", async () => {
    const { handle } = fakeHandle(["只有这些"]);
    registerTerminalHandle("s3", handle);
    expect(await jumpToAnchor("s3", anchor("1", "找不到的"))).toBe(false);
    unregisterTerminalHandle("s3", handle);
  });
});

describe("resolveActiveAnchorId", () => {
  it("参考线向上取最近锚点行", () => {
    const lines = [
      "第一条用户消息", // row 0
      "回复…",
      "第二条用户消息", // row 2
      ...Array.from({ length: 47 }, () => "后续输出"),
    ];
    /* rows=50 → 参考线 = viewportTop + min(6, 16) = 6,向上最近锚点 = row 2 */
    const { handle } = fakeHandle(lines, { viewportTop: 0, rows: 50 });
    expect(
      resolveActiveAnchorId(handle, [
        anchor("a", "第一条用户消息"),
        anchor("b", "第二条用户消息"),
      ]),
    ).toBe("b");
  });

  it("参考线在首条锚点之上时返回 null(保持原 active)", () => {
    /* rows=50 → 参考线在 row 6;锚点在 row 9(参考线下方),向上走不应命中 */
    const lines = [...Array.from({ length: 9 }, (_, i) => `无关输出 ${i}`), "用户消息在很下面"];
    const { handle } = fakeHandle(lines, { viewportTop: 0, rows: 50 });
    expect(resolveActiveAnchorId(handle, [anchor("a", "用户消息在很下面")])).toBeNull();
  });
});
