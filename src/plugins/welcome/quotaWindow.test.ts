/**
 * quotaWindow.ts 纯函数测试 —— 5h 滚动窗口推算:正常窗口/空行/全过期/
 * 未知家族/恰好 5h 边界/乱序输入。
 */

import { describe, expect, it } from "vitest";

import { QUOTA_WINDOW_MS, windowResetFor } from "./quotaWindow";
import type { UsageLine } from "../cli-shared/sessionUsage";

const NOW = Date.parse("2026-09-11T12:00:00Z");
const H = 3600_000;

const line = (ts: number): UsageLine => ({
  ts,
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
});

describe("windowResetFor", () => {
  it("正常窗口:windowStart = now-5h 内最早行,resetAt = start+5h", () => {
    const lines = [line(NOW - 6 * H), line(NOW - 2 * H), line(NOW - 30 * 60_000)];
    expect(windowResetFor("claude", lines, NOW)).toEqual({
      windowStartMs: NOW - 2 * H,
      resetAtMs: NOW - 2 * H + QUOTA_WINDOW_MS,
    });
  });

  it("空行 → null", () => {
    expect(windowResetFor("claude", [], NOW)).toBeNull();
  });

  it("全过期(所有行 < now-5h)→ null", () => {
    const lines = [line(NOW - 9 * H), line(NOW - 6 * H)];
    expect(windowResetFor("claude", lines, NOW)).toBeNull();
  });

  it("推算窗口已滚走(resetAt <= now)→ null,不显冻结值", () => {
    /* L=now-2h 过「全过期」守卫,但窗口锚在 now-6.9h → resetAt=now-1.9h 已过。 */
    const lines = [line(NOW - 6.9 * H), line(NOW - 2 * H)];
    expect(windowResetFor("claude", lines, NOW)).toBeNull();
  });

  it("未知家族(口径未知不猜)→ null;codex 有真额度体系,不在推算列", () => {
    const lines = [line(NOW - H)];
    expect(windowResetFor("omp", lines, NOW)).toBeNull();
    expect(windowResetFor("pi", lines, NOW)).toBeNull();
    expect(windowResetFor("codex", lines, NOW)).toBeNull();
  });

  it("恰好 5h 边界:ts == L-5h 的行不属于窗口(严格大于)", () => {
    const lines = [line(NOW - 6 * H), line(NOW - 4 * H), line(NOW - H)];
    expect(windowResetFor("claude", lines, NOW)).toEqual({
      windowStartMs: NOW - 4 * H,
      resetAtMs: NOW - 4 * H + QUOTA_WINDOW_MS,
    });
  });

  it("乱序输入:最大 ts 为 L,不依赖行顺序", () => {
    const lines = [line(NOW - 30 * 60_000), line(NOW - 2 * H), line(NOW - 4 * H)];
    expect(windowResetFor("claude", lines, NOW)).toEqual({
      windowStartMs: NOW - 4 * H,
      resetAtMs: NOW - 4 * H + QUOTA_WINDOW_MS,
    });
  });
});
