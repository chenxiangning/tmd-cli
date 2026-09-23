/**
 * liveText 契约:全屏 TUI 重绘以帧界切割只留当前帧;线性输出保持尾窗语义;
 * 私有前缀 CSI(ESC[>4;2m)不再漏到屏上。
 */
import { describe, expect, it } from "vitest";
import { appendLive, renderLive, stripLive } from "./liveText";

describe("renderLive 帧切割", () => {
  const PICKER = [
    "omp -- picker",
    "tab to run bash",
    "$ to run python",
    "No LSP servers",
  ].join("\n");

  it("全屏 TUI 逐帧重绘:只渲染最后一帧,不再堆重复块", () => {
    const repaint = `\x1b[2J\x1b[H${PICKER}\x1b[?25l`;
    const raw = repaint.repeat(8);
    const out = renderLive(raw, 400);
    expect(out).toBe(PICKER);
    expect(out.split("tab to run bash")).toHaveLength(2);
  });

  it("备屏切换(1049h)同为帧界:只渲染备屏内容", () => {
    const raw = `主屏旧内容\x1b[?1049h${PICKER}`;
    expect(renderLive(raw, 400)).toBe(PICKER);
  });

  it("线性输出(无清屏)保持尾窗语义", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line-${i}`);
    const out = renderLive(lines.join("\n"), 400);
    expect(out.split("\n")[0]).toBe("line-100");
    expect(out.split("\n")).toHaveLength(400);
  });

  it("appendLive 截尾防原始缓冲无限增长", () => {
    let raw = "";
    for (let i = 0; i < 6000; i++) raw = appendLive(raw, "x".repeat(64));
    expect(raw.length).toBeLessThanOrEqual(256 * 1024);
    expect(raw.endsWith("x".repeat(64))).toBe(true);
  });
});

describe("stripLive 私有序列", () => {
  it("私有前缀 CSI(ESC[>4;2m)被剥净,不再漏出 [>4;2m", () => {
    expect(stripLive("\x1b[>4;2m文本")).toBe("文本");
  });
  it("普通 CSI 与控制字节照旧剥除", () => {
    expect(stripLive("\u001b]0;t\u0007a\x1b[1mb\x08c\x00")).toBe("abc");
  });
});
