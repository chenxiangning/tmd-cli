/**
 * 插件崩溃熔断计数契约 —— 阈值触发、独立计数、已熔断幂等。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  QUARANTINE_CRASH_THRESHOLD,
  __resetPluginQuarantineForTests,
  getQuarantineReason,
  isQuarantined,
  recordPluginCrash,
  setQuarantineHandler,
} from "./pluginQuarantine";

beforeEach(() => __resetPluginQuarantineForTests());

describe("插件崩溃熔断", () => {
  it("阈值内只计数不熔断;达阈值熔断并调摘除通道", () => {
    const handler = vi.fn();
    setQuarantineHandler(handler);
    for (let i = 0; i < QUARANTINE_CRASH_THRESHOLD - 1; i++) {
      expect(recordPluginCrash("p", "boom")).toBe(false);
      expect(isQuarantined("p")).toBe(false);
    }
    expect(recordPluginCrash("p", "boom")).toBe(true);
    expect(isQuarantined("p")).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("p");
    expect(getQuarantineReason("p")).toBe("boom");
  });

  it("已熔断后重复崩溃不再触发;插件间独立计数", () => {
    const handler = vi.fn();
    setQuarantineHandler(handler);
    for (let i = 0; i < QUARANTINE_CRASH_THRESHOLD + 2; i++) recordPluginCrash("p", "x");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(recordPluginCrash("q", "y")).toBe(false);
    expect(isQuarantined("q")).toBe(false);
  });

  it("未注册摘除通道时熔断照样落态(不炸)", () => {
    for (let i = 0; i < QUARANTINE_CRASH_THRESHOLD; i++) recordPluginCrash("p", "no handler");
    expect(isQuarantined("p")).toBe(true);
    expect(getQuarantineReason("p")).toBe("no handler");
  });
});
