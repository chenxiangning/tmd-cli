/**
 * sanitizeBufferLimitInput 契约(S5 缓冲上限域对齐):
 * 域内整数原样提交(含两端边界);域外钳制到最近边界(2000 → 5万);
 * 空/非数字回落 store 当前值而非默认 —— 钳制/回落值即提交值即显示值,
 * 消「输入 2000、显示 2000、实际 50 万」的脱节。
 */
import { describe, expect, it } from "vitest";
import { BUFFER_LIMIT_MAX, BUFFER_LIMIT_MIN, sanitizeBufferLimitInput } from "./behaviorCommit";

describe("sanitizeBufferLimitInput(会话输出缓冲上限提交)", () => {
  it("域内整数原样提交(含两端边界)", () => {
    expect(sanitizeBufferLimitInput("500000", 500000)).toBe(500000);
    expect(sanitizeBufferLimitInput(String(BUFFER_LIMIT_MIN), 500000)).toBe(BUFFER_LIMIT_MIN);
    expect(sanitizeBufferLimitInput(String(BUFFER_LIMIT_MAX), 500000)).toBe(BUFFER_LIMIT_MAX);
  });

  it("域外钳制到最近边界:2000/0 → 5万,超上限 → 1000万", () => {
    expect(sanitizeBufferLimitInput("2000", 500000)).toBe(BUFFER_LIMIT_MIN);
    expect(sanitizeBufferLimitInput("0", 500000)).toBe(BUFFER_LIMIT_MIN);
    expect(sanitizeBufferLimitInput("99999999", 500000)).toBe(BUFFER_LIMIT_MAX);
  });

  it("空/非数字回落 store 当前值(不落默认 50 万)", () => {
    expect(sanitizeBufferLimitInput("", 720000)).toBe(720000);
    expect(sanitizeBufferLimitInput("abc", 720000)).toBe(720000);
  });

  it("小数与尾随杂字符按 parseInt 取整后同样过域", () => {
    expect(sanitizeBufferLimitInput("123456.7", 500000)).toBe(123456);
    expect(sanitizeBufferLimitInput("600000abc", 500000)).toBe(600000);
    expect(sanitizeBufferLimitInput("30000.9", 500000)).toBe(BUFFER_LIMIT_MIN);
  });
});
