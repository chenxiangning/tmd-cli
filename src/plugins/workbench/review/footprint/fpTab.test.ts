/**
 * fpTab 纯函数契约(payload.day → 初始视图态/年月)—— 打开深链由
 * reviewTabs.openWorkbenchReviewTab 承担(reviewTabs.test 守护),此处只守
 * fpYmOfDay/fpInitView 的合法性与回落(缺省/非法/月日出界)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as FpTabNs from "./fpTab";

let fp: typeof FpTabNs;

beforeEach(async () => {
  vi.resetModules();
  fp = await import("./fpTab");
});

describe("fpYmOfDay", () => {
  it("合法日 → {y,m};缺省/非法/月日出界 → null", () => {
    expect(fp.fpYmOfDay("2026-10-19")).toEqual({ y: 2026, m: 10 });
    expect(fp.fpYmOfDay(undefined)).toBeNull();
    expect(fp.fpYmOfDay("bad")).toBeNull();
    expect(fp.fpYmOfDay("2026-13-01")).toBeNull();
  });
});
