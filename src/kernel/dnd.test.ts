/** kernel/dnd 纯函数契约:窗口判定(跨夜/全天/边界/非法输入)与三闸共用判定。 */
import { describe, expect, it } from "vitest";
import { hhMmOf, inDndWindow, isDndActive, parseHhMm } from "./dnd";

describe("parseHhMm", () => {
  it("合法 HH:mm 转分钟,非法返回 null", () => {
    expect(parseHhMm("22:00")).toBe(22 * 60);
    expect(parseHhMm("00:00")).toBe(0);
    expect(parseHhMm("23:59")).toBe(23 * 60 + 59);
    expect(parseHhMm("24:00")).toBeNull();
    expect(parseHhMm("7:30")).toBeNull(); /* 必须两位 */
    expect(parseHhMm("22:0")).toBeNull();
    expect(parseHhMm("")).toBeNull();
    expect(parseHhMm("abc")).toBeNull();
  });
});

describe("inDndWindow", () => {
  it("同日窗:start 含、end 不含", () => {
    expect(inDndWindow("12:00", "12:00", "13:00")).toBe(true);
    expect(inDndWindow("12:59", "12:00", "13:00")).toBe(true);
    expect(inDndWindow("13:00", "12:00", "13:00")).toBe(false);
    expect(inDndWindow("11:59", "12:00", "13:00")).toBe(false);
  });

  it("跨夜窗(22:00-08:00):夜里静默,白天放行", () => {
    expect(inDndWindow("23:00", "22:00", "08:00")).toBe(true);
    expect(inDndWindow("03:30", "22:00", "08:00")).toBe(true);
    expect(inDndWindow("07:59", "22:00", "08:00")).toBe(true);
    expect(inDndWindow("08:00", "22:00", "08:00")).toBe(false);
    expect(inDndWindow("12:00", "22:00", "08:00")).toBe(false);
    expect(inDndWindow("21:59", "22:00", "08:00")).toBe(false);
    expect(inDndWindow("22:00", "22:00", "08:00")).toBe(true);
  });

  it("start === end 视为全天静默", () => {
    for (const now of ["00:00", "08:00", "12:00", "23:59"]) {
      expect(inDndWindow(now, "09:00", "09:00")).toBe(true);
    }
  });

  it("任一时刻串非法 → false(宁可响,不静默)", () => {
    expect(inDndWindow("25:00", "22:00", "08:00")).toBe(false);
    expect(inDndWindow("12:00", "bad", "08:00")).toBe(false);
    expect(inDndWindow("12:00", "22:00", "")).toBe(false);
  });
});

describe("isDndActive(三闸共用判定)", () => {
  const prefs = (enabled: boolean) => ({
    notifyDndEnabled: enabled,
    notifyDndStart: "22:00",
    notifyDndEnd: "08:00",
  });

  it("开关关 → 恒不静默", () => {
    expect(isDndActive(prefs(false), new Date(2026, 0, 1, 23, 0))).toBe(false);
  });

  it("开关开按窗口判(本地时区时刻)", () => {
    expect(isDndActive(prefs(true), new Date(2026, 0, 1, 23, 0))).toBe(true);
    expect(isDndActive(prefs(true), new Date(2026, 0, 1, 12, 0))).toBe(false);
  });
});

describe("hhMmOf", () => {
  it("Date 转两位 HH:mm", () => {
    expect(hhMmOf(new Date(2026, 0, 1, 8, 5))).toBe("08:05");
    expect(hhMmOf(new Date(2026, 0, 1, 22, 30))).toBe("22:30");
  });
});
