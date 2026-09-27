/**
 * 等待时长记账单测 —— 边沿覆写 / 结算清除 / 退出清账 / 无记录 null(spec 2026-09-27)。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  noteSessionExited,
  noteTurnSettled,
  noteWaitingAsk,
  resetWaitingSinceForTest,
  waitingSinceOf,
} from "./waitingSince";

beforeEach(() => resetWaitingSinceForTest());

describe("waitingSince", () => {
  it("边沿记时;未记录返回 null(宁缺不假)", () => {
    expect(waitingSinceOf("s1")).toBeNull();

    vi.setSystemTime(1_000_000);
    noteWaitingAsk("s1");
    expect(waitingSinceOf("s1")).toBe(1_000_000);
  });

  it("再次边沿覆写:新提问重置,不沿用上一轮起算", () => {
    vi.setSystemTime(1_000_000);
    noteWaitingAsk("s1");
    vi.setSystemTime(9_000_000);
    noteWaitingAsk("s1");
    expect(waitingSinceOf("s1")).toBe(9_000_000);
  });

  it("结算/退出清账;互不影响其他会话", () => {
    vi.setSystemTime(1_000_000);
    noteWaitingAsk("s1");
    noteWaitingAsk("s2");

    noteTurnSettled("s1");
    expect(waitingSinceOf("s1")).toBeNull();
    expect(waitingSinceOf("s2")).toBe(1_000_000);

    noteSessionExited("s2");
    expect(waitingSinceOf("s2")).toBeNull();
  });
});
