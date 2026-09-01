/**
 * vendors.ts 纯解析契约测试。
 * 覆盖:智谱 unit 映射、planLabel 提取、codex HTTP 路径禁用。
 */
import { describe, expect, it } from "vitest";
import {
  aggregateCodexUsage,
  fetchVendorQuota,
  parseZhipuLimit,
} from "./vendors";

describe("aggregateCodexUsage (WHAM 降级路径)", () => {
  it("additional_rate_limits 中的 5h 与主 rate_limit 的 7d 同时归类", () => {
    const quota = aggregateCodexUsage({
      plan_type: "plus",
      rate_limit: {
        primary_window: { used_percent: 67, limit_window_seconds: 604800 },
        secondary_window: null,
      },
      additional_rate_limits: [
        {
          rate_limit: {
            primary_window: { used_percent: 2, limit_window_seconds: 18000 },
            secondary_window: null,
          },
        },
      ],
    });
    expect(quota.planLabel).toBe("plus");
    expect(quota.windows.map((w) => w.label)).toEqual(["5小时", "7天"]);
    expect(quota.windows[0].displayPercent).toBe(2);
    expect(quota.windows[1].displayPercent).toBe(67);
  });

  it("槽位名不可信:secondary 槽位带 5h duration 时必须标为 5小时", () => {
    const quota = aggregateCodexUsage({
      rate_limit: {
        primary_window: { used_percent: 10, limit_window_seconds: 604800 },
        secondary_window: { used_percent: 3, limit_window_seconds: 18000 },
      },
    });
    expect(quota.windows.map((w) => w.label)).toEqual(["5小时", "7天"]);
    expect(quota.windows[0].displayPercent).toBe(3);
    expect(quota.windows[1].displayPercent).toBe(10);
  });
});

describe("parseZhipuLimit (智谱/GLM)", () => {
  it("unit=3 → 5小时, unit=6 → 7天, level → planLabel", () => {
    const quota = parseZhipuLimit({
      success: true,
      data: {
        level: "max",
        limits: [
          { type: "TIME_LIMIT", unit: 5, percentage: 0, nextResetTime: 1790409136999 },
          { type: "TOKENS_LIMIT", unit: 3, percentage: 12 },
          { type: "TOKENS_LIMIT", unit: 6, percentage: 34, nextResetTime: 1788335536980 },
        ],
      },
    });
    expect(quota.planLabel).toBe("max");
    expect(quota.windows.map((w) => w.label)).toEqual(["5小时", "7天"]);
    expect(quota.windows[0].displayPercent).toBe(12);
    expect(quota.windows[1].displayPercent).toBe(34);
    expect(quota.windows[1].resetsAt).toBe(1788335536980);
  });

  it("unit 缺失时按 reset 启发式:无 reset 的归 5h,有 reset 的归 7d", () => {
    const quota = parseZhipuLimit({
      success: true,
      data: {
        limits: [
          { type: "TOKENS_LIMIT", percentage: 0 },
          { type: "TOKENS_LIMIT", percentage: 88, nextResetTime: 1788335536980 },
        ],
      },
    });
    expect(quota.windows.map((w) => w.label)).toEqual(["5小时", "7天"]);
    expect(quota.windows[0].displayPercent).toBe(0);
    expect(quota.windows[1].displayPercent).toBe(88);
  });

  it("success=false 抛出 API 错误", () => {
    expect(() => parseZhipuLimit({ success: false, msg: "token 失效" })).toThrow(
      "智谱 API 错误: token 失效",
    );
  });

  it("缺 data 字段抛错", () => {
    expect(() => parseZhipuLimit({ success: true })).toThrow("智谱响应缺 data 字段");
  });
});

describe("fetchVendorQuota openai-codex 降级守卫", () => {
  it("缺 oauth 凭据时显式报错,不发请求", async () => {
    await expect(fetchVendorQuota("openai-codex", {})).rejects.toThrow(
      "缺少 openai-codex oauth 凭据",
    );
  });
});
