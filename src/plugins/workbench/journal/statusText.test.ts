/** 手动生成动作形态判定测试(dayGenAction 三态矩阵;文章 tab 顶栏与月格共用)。 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@kernel/i18n", () => ({
  t: (k: string, p?: Record<string, string | number>) => k.replace(/\{(\w+)\}/g, (_, w) => String(p?.[w] ?? `{${w}}`)),
}));

import { dayGenAction } from "./statusText";

describe("dayGenAction", () => {
  it("busy 优先:同日已有活跃任务一律禁用态,不看其余状态", () => {
    expect(dayGenAction("t", true, 3, true)).toEqual({ kind: "busy" });
    expect(dayGenAction("p", false, 2, true)).toEqual({ kind: "busy" });
    expect(dayGenAction("f", false, 1, true)).toEqual({ kind: "busy" });
  });

  it("无会话日、有文章无待归纳:无动作", () => {
    expect(dayGenAction("n", false, 0, false)).toEqual({ kind: "none" });
    expect(dayGenAction("t", true, 0, false)).toEqual({ kind: "none" });
    expect(dayGenAction("g", true, 0, false)).toEqual({ kind: "none" });
  });

  it("有文章有待归纳:增量并入并带计数(今日与往日同形)", () => {
    expect(dayGenAction("t", true, 38, false)).toEqual({ kind: "confirm", label: "增量并入 · 待归纳 38" });
    expect(dayGenAction("g", true, 1, false)).toEqual({ kind: "confirm", label: "增量并入 · 待归纳 1" });
  });

  it("无文章有会话出「生成此日」,失败日出「重试生成」", () => {
    expect(dayGenAction("p", false, 5, false)).toEqual({ kind: "confirm", label: "生成此日" });
    expect(dayGenAction("f", false, 5, false)).toEqual({ kind: "confirm", label: "重试生成" });
  });
});
