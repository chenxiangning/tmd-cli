/**
 * sliceStreamTail 截断边界契约测试。
 * 覆盖:不超上限原样返回、CSI 序列中间下刀时退回序列起点、
 * 长 OSC 超链接中间下刀同样安全、纯文本按字数截、surrogate pair 不被劈开。
 */
import { describe, expect, it } from "vitest";
import { sliceStreamTail } from "./streamSlice";

describe("sliceStreamTail", () => {
  it("不超上限时原样返回", () => {
    expect(sliceStreamTail("hello", 10)).toBe("hello");
  });

  it("截断点落在 CSI 序列中间 → 退到该序列的 ESC,保留完整序列", () => {
    /* 复现截图事故:`\x1b[38;2;107;114;128m` 曾被切成 `[38;2;107;114;128m` */
    const stream = `AAA\x1b[38;2;107;114;128mBBB\x1b[0mCCC`;
    const limit = stream.length - 5; // 截断点落在 "[38;2;..." 序列内
    const result = sliceStreamTail(stream, limit);
    expect(result).toBe("\x1b[38;2;107;114;128mBBB\x1b[0mCCC");
  });

  it("截断点落在长 OSC 8 超链接中间 → 退到 OSC 起点,不产出残片", () => {
    /* URL 超 64 字符的 OSC 8 序列:短窗口方案会漏判,反向解析必须兜住 */
    const url = `http://example.com/${"a".repeat(200)}`;
    const stream = `pre\x1b]8;;${url}\x1b\\link\x1b]8;;\x1b\\post`;
    const limit = stream.length - 10; // 截断点落在 URL 中段
    const result = sliceStreamTail(stream, limit);
    expect(result.startsWith(`\x1b]8;;${url}`)).toBe(true);
  });

  it("截断点之后序列已完结(纯文本中) → 按字数原位截断", () => {
    const stream = `\x1b[31m${"x".repeat(100)}`;
    expect(sliceStreamTail(stream, 60)).toBe("x".repeat(60));
  });

  it("截断点落在 surrogate pair 中间 → 后移一位不劈开 emoji", () => {
    const stream = `ab${"😀".repeat(50)}`;
    const limit = 50; // 50 个 code unit,必落在某个 😀(2 code unit)中间或边界
    const result = sliceStreamTail(stream, limit);
    const first = result.charCodeAt(0);
    /* 首字符必须是完整 code point 的起始,不允许是落单的 low surrogate */
    expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
  });

  it("截断点恰好在 ESC 上 → 原位截断不额外丢字节", () => {
    const stream = `12345\x1b[31mred`;
    const result = sliceStreamTail(stream, "\x1b[31mred".length);
    expect(result).toBe("\x1b[31mred");
  });
});
