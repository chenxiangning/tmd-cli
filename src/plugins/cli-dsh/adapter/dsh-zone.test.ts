/**
 * dsh-zone/click 契约:宽度裁切防换行、鼠标行级命中(区起点 + 偏移)、
 * 区收起后点击不命中、CPR 回调一次性消费。
 */

import { describe, expect, it, vi } from "vitest";
import { clipWidth, createZone } from "./dsh-zone.cjs";
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
  it("样式化超宽行截断不劈进转义序列(旧实现把 SGR 当可见宽,整行被吃)", () => {
    const out = clipWidth(print, "  \x1b[38;2;138;190;183m→ alpha-model-very-long-name-x\x1b[39m");
    const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
    expect(plain.startsWith("  → alpha-model")).toBe(true);
    expect(plain.endsWith("…")).toBe(true);
    expect(plain).not.toContain("38;2;");            /* 参数体不得残留成可见字符 */
    expect(out).toContain("\x1b[38;2;138;190;183m");  /* 起始 SGR 完整保留 */
    expect(out.endsWith("\x1b[39m\x1b[49m")).toBe(true);
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

describe("zone 交互区(擦除与 CPR)", () => {
  const mkPrint = (cols = 20) => ({ columns: () => cols, print: vi.fn(), write: vi.fn() });
  /** 注入式鼠标路由件:确定性喂 CPR 结果(真 click 件的语义已有专测)。 */
  const mkClick = () => ({
    requestCursor: vi.fn(),
    setZone: vi.fn(),
    clearZone: vi.fn(),
    hit: vi.fn(),
  });

  it("有 CPR 时按绝对行擦旧块(resize/重排后不会留半截)", async () => {
    const print = mkPrint();
    const click = mkClick();
    click.requestCursor.mockResolvedValue(6); /* 块底下一行 = 6 → 区顶 5 */
    const zone = createZone(print, click);
    zone.show(["A"], [null]);
    await vi.waitFor(() => expect(click.setZone).toHaveBeenCalledWith(5, [null]));
    print.write.mockClear();
    zone.show(["B"], [null]);
    await vi.waitFor(() => expect(print.write).toHaveBeenCalledWith("\x1b[5;1H\x1b[J"));
    expect(print.write).not.toHaveBeenCalledWith("\x1b[1A\x1b[J"); /* 不再用相对上移 */
  });

  it("CPR 超时(终端不支持)清掉旧点击区,并退回相对擦除", async () => {
    const print = mkPrint();
    const click = mkClick();
    click.requestCursor.mockResolvedValueOnce(6).mockResolvedValue(null);
    const zone = createZone(print, click);
    zone.show(["old"], [vi.fn()]);
    await vi.waitFor(() => expect(click.setZone).toHaveBeenCalledTimes(1));
    click.setZone.mockClear();
    click.clearZone.mockClear();
    print.write.mockClear();

    zone.show(["new"], [vi.fn()]);
    await vi.waitFor(() => expect(click.clearZone).toHaveBeenCalled());
    expect(click.setZone).not.toHaveBeenCalled();      /* 不再挂旧行号 */
    expect(print.write).toHaveBeenCalledWith("\x1b[1A\x1b[J"); /* 退回相对擦除 */
  });
});
