/**
 * fetchDeepseek 契约测试(is_available 语义回归):
 * - is_available = 余额是否足以调用 API,false = 欠费(欠费 pill),非「余额查不到」
 * - 余额恒展示(balanceText/balanceValue);is_available 缺失不当欠费
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@kernel/ipc", () => ({
  ipc: { quotaFetch: vi.fn(), sqliteQuery: vi.fn(), configHomeDir: vi.fn() },
}));

import { ipc } from "@kernel/ipc";
import { fetchDeepseek } from "./fetchers";

const quotaFetch = vi.mocked(ipc.quotaFetch);

beforeEach(() => {
  quotaFetch.mockReset();
});

describe("fetchDeepseek", () => {
  it("is_available=false(欠费)→ planLabel 欠费,负余额照常透出", async () => {
    quotaFetch.mockResolvedValue({
      status: 200,
      body: {
        is_available: false,
        balance_infos: [{ currency: "CNY", total_balance: "-1.29" }],
      },
    });
    const quota = await fetchDeepseek("sk-1");
    expect(quota.planLabel).toBe("欠费");
    expect(quota.balanceText).toBe("¥-1.29");
    expect(quota.balanceValue).toBe(-1.29);
    expect(quota.windows).toEqual([]);
  });

  it("is_available=true → 无 pill,余额照常", async () => {
    quotaFetch.mockResolvedValue({
      status: 200,
      body: {
        is_available: true,
        balance_infos: [{ currency: "CNY", total_balance: "42.00" }],
      },
    });
    const quota = await fetchDeepseek("sk-1");
    expect(quota.planLabel).toBeUndefined();
    expect(quota.balanceText).toBe("¥42.00");
  });

  it("is_available 缺失 → 不当欠费,无 pill", async () => {
    quotaFetch.mockResolvedValue({
      status: 200,
      body: { balance_infos: [{ currency: "USD", total_balance: "5.10" }] },
    });
    const quota = await fetchDeepseek("sk-1");
    expect(quota.planLabel).toBeUndefined();
    expect(quota.balanceText).toBe("$5.10");
  });
});
