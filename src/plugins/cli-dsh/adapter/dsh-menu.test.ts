/**
 * dsh-menu 契约:选中循环、数字直达(可视窗偏移)、窗口滚动、渲染行结构。
 */

import { describe, expect, it } from "vitest";
import { createMenu, move, pickDigit, current, renderLines, windowTop } from "./dsh-menu.cjs";

const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ label: `m${i}`, value: `v${i}` }));

describe("菜单状态机", () => {
  it("createMenu 命中 currentValue 初始选中,未命中回 0", () => {
    expect(current(createMenu("model", "t", items(3), "v1"))?.value).toBe("v1");
    expect(current(createMenu("model", "t", items(3), "zz"))?.value).toBe("v0");
  });

  it("move 循环:顶↑绕底、底↓绕顶", () => {
    const m = createMenu("model", "t", items(3), "v0");
    move(m, -1);
    expect(current(m)?.value).toBe("v2");
    move(m, 1);
    expect(current(m)?.value).toBe("v0");
  });

  it("pickDigit 可视窗内 1 基直达;越界返回 false 不动", () => {
    const m = createMenu("model", "t", items(3), "v0");
    expect(pickDigit(m, 3)).toBe(true);
    expect(current(m)?.value).toBe("v2");
    expect(pickDigit(m, 9)).toBe(false);
    expect(current(m)?.value).toBe("v2");
  });

  it("长列表窗口滚动:选中项恒在窗内,数字键按窗内偏移", () => {
    const m = createMenu("model", "t", items(30), "v0");
    for (let i = 0; i < 20; i++) move(m, 1);
    const top = windowTop(m);
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThanOrEqual(m.sel);
    expect(m.sel).toBeLessThan(top + 12);
    expect(pickDigit(m, m.sel - top + 1)).toBe(true);
  });

  it("renderLines:标题提示行 + 选中 → 行 + ✓ 当前标记 + 溢出计数行", () => {
    const withCurrent = items(3).map((it) => ({ ...it, current: it.value === "v2" }));
    const m = createMenu("model", "选择模型", withCurrent, "v0");
    const lines = renderLines(m).map((l: string) => l.replace(/\x1b\[[0-9;]*m/g, ""));
    expect(lines[0]).toContain("选择模型");
    expect(lines[1]).toContain("→");
    expect(lines[3]).toContain("✓");
    expect(lines).toHaveLength(4); /* 3 项 + 标题,无溢出行 */
  });
});
