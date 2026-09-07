/**
 * dsh-render 用户卡片契约:每行显示宽度 ≤ cols-1(超宽换行 = 「用/户」断两行
 * 的错位回归),长中文正文自动折行成多行 userBg 带。
 */

import { describe, expect, it, beforeEach } from "vitest";
import { userCardLines, displayWidth, fitWidth } from "./dsh-render.cjs";

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("userCardLines", () => {
  beforeEach(() => {
    Object.defineProperty(process.stdout, "columns", { value: 40, configurable: true });
  });

  it("短消息:首尾边框行带 ◆ 图标,全部行 ≤ cols-1", () => {
    const lines = userCardLines("你好");
    expect(lines.length).toBe(3);
    expect(plain(lines[0])).toContain("◆");
    expect(plain(lines[0])).toContain("用户");
    expect(plain(lines[2])).toContain("◆");
    for (const l of lines) expect(displayWidth(plain(l))).toBeLessThanOrEqual(39);
  });

  it("长中文正文按显示宽折行,每行不超宽", () => {
    const long = "这是一段相当长的中文消息".repeat(6);
    const lines = userCardLines(long);
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) expect(displayWidth(plain(l))).toBeLessThanOrEqual(39);
  });
});

describe("fitWidth", () => {
  it("CJK 记 2 列截断,控制序列不占宽", () => {
    const s = fitWidth("中文中文中文", 7);
    expect(displayWidth(plain(s))).toBeLessThanOrEqual(7);
    expect(s).toContain("…");
  });
});
