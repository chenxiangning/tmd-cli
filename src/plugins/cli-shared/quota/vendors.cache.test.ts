/** fetchVendorQuota 共享快照缓存单测:TTL 内单飞、并发合并、失败不缓存、键隔离。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("./vendors/fetchers", () => ({
  fetchDeepseek: vi.fn(async (key: string) => {
    calls.push(`deepseek:${key}`);
    return { windows: [], balanceText: `¥${key}` };
  }),
  fetchKimi: vi.fn(async () => {
    calls.push("kimi");
    return { windows: [{ label: "5小时", displayPercent: 10 }] };
  }),
  fetchMinimax: vi.fn(async () => {
    calls.push("minimax");
    return { windows: [] };
  }),
  fetchZhipu: vi.fn(async () => {
    calls.push("zhipu");
    return { windows: [] };
  }),
}));

import { fetchVendorQuota, resetQuotaSnapCache } from "./vendors";
import type { VendorQuota } from "./vendors/types";
import { fetchDeepseek } from "./vendors/fetchers";

const mockDeepseek = vi.mocked(fetchDeepseek);

beforeEach(() => {
  calls.length = 0;
  resetQuotaSnapCache();
  vi.useFakeTimers();
});

describe("fetchVendorQuota 共享快照缓存", () => {
  it("TTL 内同 (vendor, 凭据) 只打一次供应商", async () => {
    await fetchVendorQuota("deepseek", { key: "k1" });
    await fetchVendorQuota("deepseek", { key: "k1" });
    await fetchVendorQuota("deepseek", { key: "k1" });
    expect(calls).toEqual(["deepseek:k1"]);
  });

  it("TTL 过期后重抓", async () => {
    await fetchVendorQuota("deepseek", { key: "k1" });
    vi.advanceTimersByTime(61_000);
    await fetchVendorQuota("deepseek", { key: "k1" });
    expect(calls).toEqual(["deepseek:k1", "deepseek:k1"]);
  });

  it("并发同 key 合并为一次在飞", async () => {
    const p1 = fetchVendorQuota("kimi", { key: "k2" });
    const p2 = fetchVendorQuota("kimi", { key: "k2" });
    await Promise.all([p1, p2]);
    expect(calls).toEqual(["kimi"]);
  });

  it("键隔离:不同凭据 / 不同 vendor / 不同 baseUrl 各自缓存", async () => {
    await fetchVendorQuota("deepseek", { key: "k1" });
    await fetchVendorQuota("deepseek", { key: "k2" });
    await fetchVendorQuota("kimi", { key: "k1" });
    await fetchVendorQuota("deepseek", { key: "k1" }, "https://mirror.example");
    expect(calls).toEqual(["deepseek:k1", "deepseek:k2", "kimi", "deepseek:k1"]);
  });

  it("失败不缓存:同 key 二次调用重打", async () => {
    mockDeepseek.mockImplementationOnce(async (key: string) => {
      calls.push(`deepseek:${key}`);
      throw new Error("boom");
    });
    await expect(fetchVendorQuota("deepseek", { key: "kf" })).rejects.toThrow("boom");
    await fetchVendorQuota("deepseek", { key: "kf" });
    expect(calls).toEqual(["deepseek:kf", "deepseek:kf"]);
  });

  it("force 跳过缓存读并回写新值", async () => {
    await fetchVendorQuota("deepseek", { key: "k1" });
    await fetchVendorQuota("deepseek", { key: "k1" }, undefined, { force: true });
    expect(calls).toEqual(["deepseek:k1", "deepseek:k1"]);
    /* force 回写后,TTL 内普通调用仍吃缓存 */
    await fetchVendorQuota("deepseek", { key: "k1" });
    expect(calls).toEqual(["deepseek:k1", "deepseek:k1"]);
  });

  it("force 撞在飞:迟到前驱不得用旧数据污染缓存", async () => {
    const { promise: pendingA, resolve: releaseA } = Promise.withResolvers<VendorQuota>();
    mockDeepseek.mockImplementationOnce(() => pendingA);
    const stale = fetchVendorQuota("deepseek", { key: "ka" });
    const forced = await fetchVendorQuota("deepseek", { key: "ka" }, undefined, { force: true });
    releaseA({ windows: [{ label: "5小时", displayPercent: 99 }], balanceText: "stale" }); /* 旧数据迟到 */
    await stale;
    calls.length = 0;
    const next = await fetchVendorQuota("deepseek", { key: "ka" });
    expect(calls).toEqual([]); /* 吃 force 回写的缓存,不重抓 */
    expect(next.windows).toEqual([]); /* 缓存是 force 新值,未被迟到旧值覆盖 */
    expect(forced.windows).toEqual([]);
  });
});
