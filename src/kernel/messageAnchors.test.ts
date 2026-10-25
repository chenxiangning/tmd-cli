/** active 锚点追踪经 messageAnchors 公共出口的行为测试;跳转本体见 anchorJump.test.ts。 */

import { describe, expect, it, vi } from "vitest";

/* host 经 ipc 触达 Tauri;本测试只测纯逻辑,Mock 掉 ipc 即可(import 期无副作用)。 */
vi.mock("./ipc", () => ({
  ipc: {},
}));

import { resolveActiveAnchorId, type TerminalHandle, type UserMessageAnchor } from "./messageAnchors";

function fakeHandle(lines: string[], opts?: { viewportTop?: number; rows?: number }) {
  const state = {
    viewportTop: opts?.viewportTop ?? 0,
    rows: opts?.rows ?? 50,
  };
  const handle: TerminalHandle = {
    lineText: (row) => lines[row] ?? "",
    bufferLength: () => lines.length,
    viewportTop: () => state.viewportTop,
    rows: () => state.rows,
    scrollToLine: () => {},
    focus: () => {},
    onScroll: () => () => {},
    hasMoreHistory: () => false,
    loadEarlier: async () => {},
  };
  return { handle, state };
}

const anchor = (id: string, text: string): UserMessageAnchor => ({ id, text });


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
