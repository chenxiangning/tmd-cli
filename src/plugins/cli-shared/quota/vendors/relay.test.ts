/**
 * relay.ts(未知中转站:Sub2API → New API 回退)与 detect.ts(供应商识别)契约测试。
 *
 * 覆盖契约:
 * - fetchRelay 主路径:请求 <origin>/v1/usage 并携带 Bearer 头;usage URL 派生
 *   (去 query/尾斜杠、剥 chat/completions 等端点后缀、无 /v1 前缀时丢路径补全)
 * - Sub2API code 闸门:ok/success 放行;非 ok 但携带 balance 放行;非 ok 且无 balance 回退 New API
 * - 窗口解析:名称分类(5h/7天/30天/1天/透传)、名称字段回退链(name→id→window→type→label)、
 *   百分比四级回退(used_percent→used/limit→remaining_percent 取反→remaining/limit)、
 *   同 label 去重、最多保留 2 个、resetsAt 秒/ISO 归一
 * - subscription 嵌套 daily/weekly 折算为窗口
 * - 余额解析:balance→remaining→wallet 回退、单位符号(CNY→¥/USD→$/其他→前缀)、planLabel
 * - New API 回退:/api/user/self、quota/500000→美元、负额钳 0、success=false 但有 data 仍解析
 * - 双侧失败时透出 Sub2API 的原始错误;非法 base_url 显式报错且不发请求
 * - detectVendorByBaseUrl 域名映射/大小写不敏感/未知归 relay/dashscope 归 unsupported
 * - vendorFromModel 首段提取与哨兵过滤;detectVendorByProviderId 别名补充
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@kernel/ipc", () => ({
  ipc: { quotaFetch: vi.fn(), sqliteQuery: vi.fn(), configHomeDir: vi.fn() },
}));

import { ipc } from "@kernel/ipc";
import type { QuotaWindow } from "@kernel/quota";
import { fetchRelay } from "./relay";
import {
  detectVendorByBaseUrl,
  detectVendorByProviderId,
  vendorFromModel,
} from "./detect";

const quotaFetch = vi.mocked(ipc.quotaFetch);

function ok(body: unknown): { status: number; body: unknown } {
  return { status: 200, body };
}

function lastUrl(): string {
  return quotaFetch.mock.calls.at(-1)![0].url;
}

beforeEach(() => {
  quotaFetch.mockReset();
});

describe("fetchRelay · Sub2API 主路径", () => {
  it("请求 <origin>/v1/usage 并携带 Bearer 头;窗口与余额解析", async () => {
    quotaFetch.mockResolvedValue(
      ok({ code: "ok", rate_limits: [{ name: "5h", used_percent: 12.4 }], balance: 12.5 }),
    );
    const quota = await fetchRelay("https://r.example/v1", "sk-1");
    expect(lastUrl()).toBe("https://r.example/v1/usage");
    expect(quotaFetch.mock.calls[0][0].headers).toMatchObject({ Authorization: "Bearer sk-1" });
    expect(quota.windows).toEqual([{ label: "5小时", displayPercent: 12 }]);
    expect(quota.balanceText).toBe("$12.50");
  });

  it("usage URL 派生:去 query/尾斜杠、剥端点后缀、无 /v1 前缀时丢弃路径补全", async () => {
    quotaFetch.mockResolvedValue(ok({ code: "ok", balance: 1 })); // 成功响应,避免回退污染断言
    await fetchRelay("https://r.example", "k");
    expect(lastUrl()).toBe("https://r.example/v1/usage"); // 裸域名补 /v1
    await fetchRelay("https://r.example/v1/chat/completions", "k");
    expect(lastUrl()).toBe("https://r.example/v1/usage"); // 端点后缀剥离
    await fetchRelay("https://r.example/api/v1?api_key=x", "k");
    expect(lastUrl()).toBe("https://r.example/api/v1/usage"); // query 剥离、/v1 路径保留
    await fetchRelay("https://r.example/api/v1/responses", "k");
    expect(lastUrl()).toBe("https://r.example/api/v1/usage");
    await fetchRelay("https://r.example/v1//", "k");
    expect(lastUrl()).toBe("https://r.example/v1/usage"); // 尾斜杠
  });

  it("base_url 非法 http(s) URL 时显式报错并带原值,不发请求", async () => {
    await expect(fetchRelay("notaurl", "k")).rejects.toThrow(
      "base_url 不是合法 http(s) URL: notaurl",
    );
    expect(quotaFetch).not.toHaveBeenCalled();
  });

  it("code=ok/success 放行;非 ok 但携带 balance 也放行", async () => {
    quotaFetch.mockResolvedValue(ok({ code: "success", rate_limits: [{ name: "day", used_percent: 1 }] }));
    expect((await fetchRelay("https://r.example", "k")).windows.map((w) => w.label)).toEqual(["1天"]);
    quotaFetch.mockResolvedValue(ok({ code: "whatever", balance: 5 }));
    expect((await fetchRelay("https://r.example", "k")).balanceText).toBe("$5.00");
  });

  it("非 ok 且无 balance → 回退 New API(第二请求打 /api/user/self)", async () => {
    quotaFetch
      .mockResolvedValueOnce(ok({ code: "invalid api key" }))
      .mockResolvedValueOnce(ok({ data: { quota: 2_500_000, group: "vip" } }));
    const quota = await fetchRelay("https://r.example/v1", "sk");
    expect(quotaFetch).toHaveBeenCalledTimes(2);
    expect(lastUrl()).toBe("https://r.example/api/user/self");
    expect(quota.balanceText).toBe("$5.00");
    expect(quota.planLabel).toBe("vip");
  });

  it("Sub2API 与 New API 均无额度数据 → 报 Sub2API 响应无额度数据", async () => {
    quotaFetch.mockResolvedValue(ok({ code: "ok" }));
    await expect(fetchRelay("https://r.example", "k")).rejects.toThrow("Sub2API 响应无额度数据");
  });
});

describe("fetchRelay · Sub2API 窗口解析", () => {
  async function windowsOf(body: Record<string, unknown>) {
    quotaFetch.mockResolvedValue(ok({ code: "ok", ...body }));
    return (await fetchRelay("https://r.example", "k")).windows;
  }

  it("窗口名分类:5h/7-day/monthly/daily 归中文标签,未知名透传", async () => {
    const labelPct = (ws: QuotaWindow[]) => ws.map((w) => [w.label, w.displayPercent]);
    // 响应结果全局截留 2 窗,分类断言按每次响应 ≤2 窗分组
    expect(labelPct(await windowsOf({
      windows: [{ name: " Five Hour ", used_percent: 1 }, { name: "7-day", used_percent: 2 }],
    }))).toEqual([["5小时", 1], ["7天", 2]]);
    expect(labelPct(await windowsOf({
      windows: [{ name: "MONTHLY", used_percent: 3 }, { name: "daily", used_percent: 4 }],
    }))).toEqual([["30天", 3], ["1天", 4]]);
    expect(labelPct(await windowsOf({
      windows: [{ name: "自定义", used_percent: 5 }],
    }))).toEqual([["自定义", 5]]);
  });

  it("名称字段回退链 name→id→window→type→label;百分比四级回退", async () => {
    const labelPct = (ws: QuotaWindow[]) => ws.map((w) => [w.label, w.displayPercent]);
    expect(labelPct(await windowsOf({
      limits: [
        { id: "7d", used: 30, limit: 100 },
        { type: "5h", remaining_percent: 70 },
      ],
    }))).toEqual([["7天", 30], ["5小时", 30]]);
    expect(labelPct(await windowsOf({
      limits: [
        { label: "池", remaining: 25, quota: 100 },
        { window: "x", used_percent: 9 },
      ],
    }))).toEqual([["池", 75], ["x", 9]]);
  });

  it("无百分比条目跳过;同 label 去重;最多保留 2 个窗口", async () => {
    const ws = await windowsOf({
      rate_limits: [{ name: "5h", used_percent: 10 }, { name: "无数据" }],
      windows: [
        { name: "5h", used_percent: 99 },
        { name: "week", used_percent: 20 },
        { name: "month", used_percent: 30 },
      ],
    });
    expect(ws.map((w) => w.label)).toEqual(["5小时", "7天"]);
    expect(ws).toHaveLength(2);
  });

  it("resetsAt 归一:秒→ms、ISO 串→ms(缺失字段由主路径精确 toEqual 覆盖)", async () => {
    const ws = await windowsOf({
      rate_limits: [
        { name: "5h", used_percent: 1, reset_at: 1_788_740_000 },
        { name: "week", used_percent: 2, resetsAt: "2026-09-20T00:00:00Z" },
      ],
    });
    expect(ws[0].resetsAt).toBe(1_788_740_000_000);
    expect(ws[1].resetsAt).toBe(Date.parse("2026-09-20T00:00:00Z"));
  });

  it("subscription 嵌套 daily/weekly 折算为窗口", async () => {
    const ws = await windowsOf({
      subscription: {
        daily: { used_percent: 11, reset_at: 1_788_740_000 },
        weekly: { used_percent: 22 },
      },
    });
    expect(ws.map((w) => [w.label, w.displayPercent])).toEqual([
      ["1天", 11],
      ["7天", 22],
    ]);
  });

  it("余额单位符号:CNY→¥、EUR→'EUR '、缺省 USD→$;balance→remaining→wallet 回退", async () => {
    quotaFetch.mockResolvedValue(ok({ code: "ok", balance: 3.5, unit: "CNY" }));
    expect((await fetchRelay("https://r.example", "k")).balanceText).toBe("¥3.50");
    quotaFetch.mockResolvedValue(ok({ code: "ok", remaining: 7, currency: "EUR" }));
    expect((await fetchRelay("https://r.example", "k")).balanceText).toBe("EUR 7.00");
    quotaFetch.mockResolvedValue(ok({ code: "ok", wallet: { balance: 1.2 } }));
    expect((await fetchRelay("https://r.example", "k")).balanceText).toBe("$1.20");
  });

  it("planName/plan_name 提取 planLabel,空白值忽略", async () => {
    quotaFetch.mockResolvedValue(ok({ code: "ok", planName: " Pro ", balance: 1 }));
    expect((await fetchRelay("https://r.example", "k")).planLabel).toBe("Pro");
    quotaFetch.mockResolvedValue(ok({ code: "ok", plan_name: "  ", balance: 1 }));
    expect((await fetchRelay("https://r.example", "k")).planLabel).toBeUndefined();
  });
});

describe("fetchRelay · New API 回退", () => {
  it("Sub2API HTTP 失败 → 请求 <origin>/api/user/self;quota/500000 折算美元", async () => {
    quotaFetch
      .mockResolvedValueOnce({ status: 404, body: "nf" })
      .mockResolvedValueOnce(ok({ data: { quota: 2_500_000 } }));
    const quota = await fetchRelay("https://r.example/v1/chat/completions", "k");
    expect(lastUrl()).toBe("https://r.example/api/user/self");
    expect(quota.windows).toEqual([]);
    expect(quota.balanceText).toBe("$5.00");
  });

  it("负额度钳为 $0.00;无 data 包裹时读顶层 quota", async () => {
    quotaFetch
      .mockResolvedValueOnce({ status: 500, body: null })
      .mockResolvedValueOnce(ok({ quota: -10 }));
    expect((await fetchRelay("https://r.example", "k")).balanceText).toBe("$0.00");
  });

  it("success=false 但 data 存在 → 仍按 data 解析 remain_quota", async () => {
    quotaFetch
      .mockResolvedValueOnce({ status: 500, body: null })
      .mockResolvedValueOnce(ok({ success: false, data: { remain_quota: 500_000 } }));
    expect((await fetchRelay("https://r.example", "k")).balanceText).toBe("$1.00");
  });

  it("双侧失败透出 Sub2API 的错误(而非 New API 的)", async () => {
    quotaFetch
      .mockResolvedValueOnce({ status: 401, body: null })
      .mockResolvedValueOnce({ status: 500, body: "boom" });
    await expect(fetchRelay("https://r.example", "k")).rejects.toThrow("鉴权失败 (HTTP 401)");
  });
});

describe("detect · 供应商识别", () => {
  it("detectVendorByBaseUrl 域名映射、大小写不敏感与未知边界", () => {
    expect(detectVendorByBaseUrl("https://api.kimi.com/coding/v1")).toBe("kimi");
    expect(detectVendorByBaseUrl("https://open.bigmodel.cn/api")).toBe("zhipu-cn");
    expect(detectVendorByBaseUrl("https://api.z.ai/v1")).toBe("zhipu-en");
    expect(detectVendorByBaseUrl("https://api.minimaxi.com/v1")).toBe("minimax-cn");
    expect(detectVendorByBaseUrl("https://api.minimax.io/v1")).toBe("minimax-en");
    expect(detectVendorByBaseUrl("https://api.deepseek.com")).toBe("deepseek");
    expect(detectVendorByBaseUrl("https://coding.dashscope.aliyuncs.com/v1")).toBe("unsupported");
    expect(detectVendorByBaseUrl("https://coding-intl.dashscope.aliyuncs.com/v1")).toBe("unsupported");
    expect(detectVendorByBaseUrl("https://relay.example.com/v1")).toBe("relay");
    expect(detectVendorByBaseUrl("HTTPS://API.KIMI.COM/CODING")).toBe("kimi");
  });

  it("vendorFromModel:取首段并 trim,__哨兵__与空值归 null", () => {
    expect(vendorFromModel("zhipu/glm-5")).toBe("zhipu");
    expect(vendorFromModel(" openai ")).toBe("openai");
    expect(vendorFromModel("vendor/")).toBe("vendor");
    expect(vendorFromModel("__masked__")).toBeNull();
    expect(vendorFromModel("  ")).toBeNull();
    expect(vendorFromModel(null)).toBeNull();
    expect(vendorFromModel(undefined)).toBeNull();
  });

  it("detectVendorByProviderId 别名补充:kimi/minimax/deepseek/codex 与大小写空白", () => {
    expect(detectVendorByProviderId("Kimi-Coding")).toBe("kimi");
    expect(detectVendorByProviderId(" minimax-code-en ")).toBe("minimax-en");
    expect(detectVendorByProviderId("bigmodel-cn")).toBe("zhipu-cn");
    expect(detectVendorByProviderId("glm-coding-en")).toBe("zhipu-en");
    expect(detectVendorByProviderId("deepseek-official")).toBe("deepseek");
    expect(detectVendorByProviderId("openai-codex")).toBe("openai-codex");
    expect(detectVendorByProviderId("totally-unknown")).toBeNull();
  });
});
