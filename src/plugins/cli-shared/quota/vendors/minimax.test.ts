/**
 * minimax 口径断言(fetchMinimax)—— 接口语义是「剩余百分比」
 * (current_interval_remaining_percent / current_weekly_remaining_percent),
 * 而 QuotaSnapshot.usedLabel 恒「已使用」(toQuotaSnapshot 塑形),
 * fetcher 必须做 100 - remaining 取反;此测试钉死该换算,防后续误改。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@kernel/ipc", () => ({
  ipc: { quotaFetch: vi.fn(), sqliteQuery: vi.fn(), configHomeDir: vi.fn() },
}));

import { ipc } from "@kernel/ipc";
import { fetchMinimax } from "./fetchers";
import { toQuotaSnapshot } from "./index";

const quotaFetch = vi.mocked(ipc.quotaFetch);

function ok(body: unknown): { status: number; body: unknown } {
  return { status: 200, body };
}

beforeEach(() => {
  quotaFetch.mockReset();
});

describe("fetchMinimax · 剩余→已用口径钉死", () => {
  it("current_interval_remaining_percent=85 → 5小时窗口已用 15%", async () => {
    quotaFetch.mockResolvedValue(
      ok({
        base_resp: { status_code: 0 },
        model_remains: [
          { model_name: "general", current_interval_remaining_percent: 85, end_time: 1_800_000_000 },
        ],
      }),
    );
    const quota = await fetchMinimax("sk-1", true);
    expect(quotaFetch.mock.calls[0][0].url).toContain("api.minimaxi.com");
    expect(quota.windows).toEqual([
      { label: "5小时", displayPercent: 15, resetsAt: 1_800_000_000_000 },
    ]);
    /* usedLabel 语义核对:窗口是「已用」口径,与 QuotaSnapshot 恒「已使用」一致。 */
    const snap = toQuotaSnapshot("MiniMax", "minimax-cn", quota);
    expect(snap.usedLabel).toBe("已使用");
  });

  it("weekly_status=1 时 7 天窗口同为 100 - remaining 取反", async () => {
    quotaFetch.mockResolvedValue(
      ok({
        base_resp: { status_code: 0 },
        model_remains: [
          {
            model_name: "general",
            current_interval_remaining_percent: 100,
            current_weekly_status: 1,
            current_weekly_remaining_percent: 30,
          },
        ],
      }),
    );
    const quota = await fetchMinimax("sk-1", false);
    expect(quotaFetch.mock.calls[0][0].url).toContain("api.minimax.io");
    /* 区间窗 100-100=0 同样入列;7 天窗取反 70。 */
    expect(quota.windows).toEqual([
      { label: "5小时", displayPercent: 0 },
      { label: "7天", displayPercent: 70 },
    ]);
  });

  it("无 general 条目 → 空窗(显「—」,不发明数据);API 报错透传", async () => {
    quotaFetch.mockResolvedValue(ok({ base_resp: { status_code: 0 }, model_remains: [] }));
    expect((await fetchMinimax("sk-1", true)).windows).toEqual([]);
    quotaFetch.mockResolvedValue(
      ok({ base_resp: { status_code: 1001, status_msg: "bad" } }),
    );
    await expect(fetchMinimax("sk-1", true)).rejects.toThrow("1001");
  });
});
