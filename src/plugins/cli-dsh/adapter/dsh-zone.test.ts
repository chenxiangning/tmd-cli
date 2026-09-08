/**
 * dsh-zone/click 契约:宽度裁切防换行、鼠标行级命中(区起点 + 偏移)、
 * 区收起后点击不命中、CPR 回调一次性消费。
 */

import { describe, expect, it, vi } from "vitest";
import { clipWidth } from "./dsh-zone.cjs";
import { init, setZone, clearZone, hit, requestCursor, onCpr } from "./dsh-click.cjs";

const print = { columns: () => 20 };

describe("clipWidth", () => {
  it("超长可见文本裁到终端宽并加省略号;ANSI 码保留", () => {
    const out = clipWidth(print, "\x1b[31m" + "a".repeat(50) + "\x1b[39m");
    const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
    expect(plain.length).toBeLessThanOrEqual(20);
    expect(plain.endsWith("…")).toBe(true);
    expect(out).toContain("\x1b[31m");
  });
  it("短文本原样", () => {
    expect(clipWidth(print, "abc")).toBe("abc");
  });
  it("CJK 记 2 列:11 汉字(22 列)在 20 列终端裁到 ≤20 列 + 省略号", () => {
    const out = clipWidth(print, "请说明需求请说明需求啊");
    const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
    let w = 0;
    for (const ch of plain) w += /[\u4e00-\u9fff]/.test(ch) ? 2 : 1;
    expect(w).toBeLessThanOrEqual(20);
    expect(plain.endsWith("…")).toBe(true);
  });
});

describe("click 路由", () => {
  it("setZone 后按行命中回调;越界/空槽不命中;clearZone 后全不命中", () => {
    const fake = { write: vi.fn() };
    init(fake);
    const a = vi.fn();
    setZone(10, [null, a]);
    expect(hit(10)).toBe(false); /* 标题槽 null */
    expect(hit(11)).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(hit(12)).toBe(false); /* 区外 */
    clearZone();
    expect(hit(11)).toBe(false);
  });

  it("requestCursor 写 ESC[6n,onCpr 按序回给等待者", async () => {
    const fake = { write: vi.fn() };
    init(fake);
    const p = requestCursor();
    expect(fake.write).toHaveBeenCalledWith("\x1b[6n");
    onCpr(42);
    expect(await p).toBe(42);
    onCpr(1); /* 无等待者静默不抛 */
  });
});
