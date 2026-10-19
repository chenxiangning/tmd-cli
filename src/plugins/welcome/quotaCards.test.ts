/**
 * quotaCards 纯函数测试:卡片构建(双窗口并列/展示序)/查不到的卡不渲染/
 * claude 推算卡去重/汇总条目标跨窗口取最早/倒计时拆分/凭据去重聚合。
 * inferClaudeWindow 为 IO 编排(ipc 尾读),走桩目检,不在此测。
 */
import { describe, expect, it } from "vitest";
import type { QuotaWindow } from "@kernel/quota";
import {
  aggregateQuotas,
  buildQuotaCards,
  nextQuotaWindow,
  QUOTA_HOT_PCT,
  splitCountdown,
} from "./quotaCards";
import type { EngineCredential } from "./credentials";

const W = (label: string, pct: number, resetsAt?: number): QuotaWindow =>
  resetsAt != null ? { label, displayPercent: pct, resetsAt } : { label, displayPercent: pct };

const NOW = Date.parse("2026-10-19T12:00:00Z");
const H = 3600_000;

describe("buildQuotaCards", () => {
  it("双窗口卡:5 小时与 7 天并列,5 小时在展示序前;90% 触发已限额", () => {
    const cards = buildQuotaCards({
      quotas: [
        {
          title: "Codex 账号额度",
          planLabel: "pro",
          windows: [W("7天", 70, NOW + 3 * 86400_000), W("5小时", QUOTA_HOT_PCT, NOW + 40 * 60_000)],
        },
      ],
      claudeWin: null,
      claudeHasQuota: false,
    });
    expect(cards).toHaveLength(1);
    const c = cards[0];
    expect(c).toMatchObject({ name: "Codex 账号额度", plan: "pro" });
    expect(c.windows.map((w) => w.label)).toEqual(["5小时", "7天"]);
    expect(c.windows[0]).toMatchObject({ pct: QUOTA_HOT_PCT, hot: true, resetsAt: NOW + 40 * 60_000 });
    expect(c.windows[1]).toMatchObject({ pct: 70, hot: false, resetsAt: NOW + 3 * 86400_000 });
  });

  it("查不到的卡不渲染:仅 note / 仅余额 / 空窗口聚合全部丢弃", () => {
    const cards = buildQuotaCards({
      quotas: [
        { title: "Claude 官方订阅", windows: [], note: "已登录;官方订阅额度请在 CLI 内 /usage 查看" },
        { title: "DeepSeek 账户余额", windows: [], balanceText: "¥-1.29" },
        { title: "空", windows: [] },
      ],
      claudeWin: null,
      claudeHasQuota: false,
    });
    expect(cards).toEqual([]);
  });

  it("claude 推算卡:有推算且无真额度时追加,单推算窗口(无环形读数)", () => {
    const cards = buildQuotaCards({
      quotas: [],
      claudeWin: { startMs: NOW - 2 * H, resetAtMs: NOW + 3 * H },
      claudeHasQuota: false,
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ name: "claude" });
    expect(cards[0].windows).toEqual([
      {
        key: "5小时",
        label: "5小时",
        pct: null,
        hot: false,
        resetsAt: NOW + 3 * H,
        startMs: NOW - 2 * H,
        inferred: true,
      },
    ]);
  });

  it("claude 已有真额度窗口时推算卡不重复", () => {
    const cards = buildQuotaCards({
      quotas: [{ title: "Claude 官方订阅", windows: [W("5小时", 10, NOW + H)] }],
      claudeWin: { startMs: NOW - H, resetAtMs: NOW + 4 * H },
      claudeHasQuota: true,
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].windows.every((w) => !w.inferred)).toBe(true);
  });

  it("卡按卡内最早重置时刻升序(汇总条同序)", () => {
    const cards = buildQuotaCards({
      quotas: [
        { title: "晚", windows: [W("5小时", 10, NOW + 5 * H)] },
        { title: "早", windows: [W("7天", 10, NOW + H), W("5小时", 10, NOW + 6 * H)] },
      ],
      claudeWin: null,
      claudeHasQuota: false,
    });
    expect(cards.map((c) => c.name)).toEqual(["早", "晚"]);
  });
});

describe("nextQuotaWindow", () => {
  const cards = buildQuotaCards({
    quotas: [
      { title: "甲", windows: [W("5小时", 10, NOW + 5 * H), W("7天", 10, NOW + 30 * 60_000)] },
      { title: "乙", windows: [W("5小时", 10, NOW + H)] },
      { title: "丙", windows: [W("5小时", 10, NOW - H)] },
    ],
    claudeWin: null,
    claudeHasQuota: false,
  });

  it("跨全部窗口取重置最近且未过期者(7 天窗可早于别家 5 小时窗)", () => {
    /* 甲的 7 天窗(NOW+30m)早于乙的 5 小时窗(NOW+1h)→ 汇总先报甲 7 天 */
    const n1 = nextQuotaWindow(cards, NOW);
    expect(n1?.card.name).toBe("甲");
    expect(n1?.win.label).toBe("7天");
    /* 30 分钟窗过期后轮到乙的 5 小时窗 */
    const n2 = nextQuotaWindow(cards, NOW + 40 * 60_000);
    expect(n2?.card.name).toBe("乙");
    expect(n2?.win.label).toBe("5小时");
    /* 全部过期后无目标 */
    expect(nextQuotaWindow(cards, NOW + 8 * 86400_000)).toBeNull();
  });
});

describe("splitCountdown", () => {
  it("分钟粒度向上取整;不足一小时纯分钟;<=0 为已重置终态", () => {
    expect(splitCountdown(78 * 60_000 + 1)).toEqual({ h: 1, m: 19 });
    expect(splitCountdown(40 * 60_000)).toEqual({ h: 0, m: 40 });
    expect(splitCountdown(30_000)).toEqual({ h: 0, m: 1 });
    expect(splitCountdown(0)).toBeNull();
    expect(splitCountdown(-H)).toBeNull();
  });
});

describe("aggregateQuotas", () => {
  const cred = (over: Partial<EngineCredential>): EngineCredential => ({
    providerId: "p",
    title: "T",
    windows: [],
    ...over,
  });

  it("同 title 择优:有窗口 > 有余额 > 仅 note;无信息量条目丢弃", () => {
    const list = [
      cred({ note: "timeout" }),
      cred({ balanceText: "$1" }),
      cred({ windows: [W("5小时", 50)], note: "stale" }),
      cred({ title: "空", windows: [] }),
    ];
    const aggs = aggregateQuotas({ omp: list });
    expect(aggs).toHaveLength(1);
    expect(aggs[0]).toMatchObject({ title: "T", windows: [W("5小时", 50)] });
  });
});
