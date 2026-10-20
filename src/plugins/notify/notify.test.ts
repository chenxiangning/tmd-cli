/**
 * notify 纯逻辑契约测试:发送闸(分类开关 × 窗口聚焦)与文案、额度阈值判定。
 * 模块级纯函数,直接 import 无需环境桩。
 */
import { describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "@kernel/ipc";
import { notifyText, reopenNotifySession, shouldNotify } from "./logic";
import {
  pickBalanceWarning,
  pickQuotaWarnings,
  pickResetWarning,
  watchedQuotaSessions,
} from "./quotaWatch";

const PREFS = {
  notifyOsAsk: true,
  notifyOsTurnEnd: true,
  notifyOsSessionExit: false,
  notifyOsQuota: true,
};

const LOOKUP = {
  getSessions: () => [{ id: "s1", profileId: "omp", title: "改审批线" }],
};

describe("shouldNotify(发送闸)", () => {
  it("聚焦即静默:用户在场,一切类别不发", () => {
    expect(shouldNotify("ask", PREFS, true)).toBe(false);
    expect(shouldNotify("turnEnd", PREFS, true)).toBe(false);
    expect(shouldNotify("exit", PREFS, true)).toBe(false);
  });

  it("失焦按分类开关放行", () => {
    expect(shouldNotify("ask", PREFS, false)).toBe(true);
    expect(shouldNotify("turnEnd", PREFS, false)).toBe(true);
    expect(shouldNotify("exit", PREFS, false)).toBe(false); // 默认关
  });

  it("关掉开关即不发(逐类独立)", () => {
    const off = {
      notifyOsAsk: false,
      notifyOsTurnEnd: false,
      notifyOsSessionExit: true,
      notifyOsQuota: true,
    };
    expect(shouldNotify("ask", off, false)).toBe(false);
    expect(shouldNotify("turnEnd", off, false)).toBe(false);
    expect(shouldNotify("exit", off, false)).toBe(true);
  });

  it("quota 走同款三闸:聚焦/免打扰窗静默,notifyOsQuota 开关独立", () => {
    /* 免打扰窗内 OS 静但流水照记(fireQuota 记流水在前,闸只拦 OS 通道)。 */
    const allday = { notifyDndEnabled: true, notifyDndStart: "00:00", notifyDndEnd: "00:00" };
    expect(shouldNotify("quota", PREFS, false, allday)).toBe(false);
    expect(shouldNotify("quota", PREFS, true)).toBe(false);
    expect(shouldNotify("quota", PREFS, false)).toBe(true);
    expect(shouldNotify("quota", { ...PREFS, notifyOsQuota: false }, false)).toBe(false);
  });

  it("免打扰窗内静默(三闸之一);开关关不受影响", () => {
    /* start === end = 全天静默:与运行时刻无关,断言确定。 */
    const allday = { notifyDndEnabled: true, notifyDndStart: "00:00", notifyDndEnd: "00:00" };
    expect(shouldNotify("ask", PREFS, false, allday)).toBe(false);
    expect(shouldNotify("ask", PREFS, false, { ...allday, notifyDndEnabled: false })).toBe(true);
  });
});

describe("notifyText(文案)", () => {
  it("会话名走 title 覆盖,退 profileId,再退裸 id", () => {
    expect(notifyText("ask", "s1", LOOKUP).body).toContain("「改审批线」");
    const noTitle = {
      getSessions: () => [{ id: "s2", profileId: "claude" }],
    };
    expect(notifyText("ask", "s2", noTitle).body).toContain("「claude」");
    const nothing = { getSessions: () => [] };
    expect(notifyText("turnEnd", "ghost", nothing).body).toContain("「ghost」");
  });

  it("三类标题互不相同", () => {
    const titles = ["ask", "turnEnd", "exit"].map((k) => notifyText(k as "ask", "s1", LOOKUP).title);
    expect(new Set(titles).size).toBe(3);
  });
});

describe("reopenNotifySession(通知中心行回跳决策)", () => {
  /** 可断言桩:记录 setActiveSession / openDiskSession 调用。 */
  function mkHost(liveIds: string[]) {
    const calls: { active?: string; disk?: unknown[] } = {};
    return {
      calls,
      h: {
        getSessions: () => liveIds.map((id) => ({ id })),
        setActiveSession: vi.fn((id: string) => {
          calls.active = id;
        }),
        openDiskSession: vi.fn((...args: unknown[]) => {
          calls.disk = args;
          return Promise.resolve({ id: "pty-1" });
        }),
      },
    };
  }

  it("活会话:仅聚焦,不走磁盘 resume", () => {
    const { h, calls } = mkHost(["pty-1"]);
    reopenNotifySession(
      { sessionId: "pty-1", profileId: "omp", cwd: "/w", cliSessionId: "cli-1" },
      h,
    );
    expect(calls.active).toBe("pty-1");
    expect(h.openDiskSession).not.toHaveBeenCalled();
  });

  it("tab 已关/重启过:按记录时刻快照 resume 重开", () => {
    const { h, calls } = mkHost([]);
    reopenNotifySession(
      { sessionId: "pty-old", profileId: "omp", cwd: "/w", workspaceId: "ws1", cliSessionId: "cli-9" },
      h,
    );
    expect(calls.active).toBeUndefined();
    expect(h.openDiskSession).toHaveBeenCalledWith("omp", "/w", "ws1", "cli-9");
  });

  it("旧流水无磁盘身份快照:仅维持已发手势,不聚焦也不 resume", () => {
    const { h, calls } = mkHost([]);
    reopenNotifySession({ sessionId: "pty-gone" }, h);
    expect(calls.active).toBeUndefined();
    expect(h.openDiskSession).not.toHaveBeenCalled();
  });
});

describe("pickQuotaWarnings(额度阈值判定)", () => {
  const W = (label: string, pct: number, resetsAt?: number) => ({ label, displayPercent: pct, resetsAt });
  const labels = (ws: Array<{ label: string }>) => ws.map((w) => w.label);

  it("引擎前缀隔离去重键:不同供应商同标签窗口互不吞键", () => {
    const seen = new Set<string>();
    expect(labels(pickQuotaWarnings([W("5小时", 90, 1000)], 10, seen, "omp:"))).toEqual(["5小时"]);
    /* omp 报过的键不拦 pi 的同形窗口(键带前缀)。 */
    expect(labels(pickQuotaWarnings([W("5小时", 90, 1000)], 10, seen, "pi:"))).toEqual(["5小时"]);
    expect(pickQuotaWarnings([W("5小时", 95, 1000)], 10, seen, "pi:")).toEqual([]);
  });

  it("过阈告警,未阈不报", () => {
    const seen = new Set<string>();
    const fired = pickQuotaWarnings([W("5小时", 90), W("7天", 8)], 10, seen);
    expect(labels(fired)).toEqual(["5小时"]);
  });

  it("同一窗口周期只报一次(resetsAt 变化即新周期重报)", () => {
    const seen = new Set<string>();
    expect(labels(pickQuotaWarnings([W("5小时", 90, 1000)], 10, seen))).toEqual(["5小时"]);
    expect(pickQuotaWarnings([W("5小时", 95, 1000)], 10, seen)).toEqual([]);
    expect(labels(pickQuotaWarnings([W("5小时", 96, 2000)], 10, seen))).toEqual(["5小时"]);
  });

  it("25% 升级桶:无 resetsAt 的占比型快照越桶可再报(修 dsh 终生一次)", () => {
    const seen = new Set<string>();
    expect(labels(pickQuotaWarnings([W("上下文", 12, undefined)], 10, seen))).toEqual(["上下文"]);
    expect(pickQuotaWarnings([W("上下文", 20, undefined)], 10, seen)).toEqual([]); // 同桶不重报
    expect(labels(pickQuotaWarnings([W("上下文", 38, undefined)], 10, seen))).toEqual(["上下文"]); // 越桶再报
  });

  it("无 resetsAt 的窗口键不含时刻段,同样去重", () => {
    const seen = new Set<string>();
    expect(labels(pickQuotaWarnings([W("5小时", 90)], 10, seen))).toEqual(["5小时"]);
    expect(pickQuotaWarnings([W("5小时", 91)], 10, seen)).toEqual([]);
  });

  it("0 阈值全报(调用方以 threshold<=0 短路,这里只验纯函数语义)", () => {
    const seen = new Set<string>();
    expect(labels(pickQuotaWarnings([W("5小时", 0)], 0, seen))).toEqual(["5小时"]);
  });
});

describe("watchedQuotaSessions(额度监控面:运行中 ∪ 平铺幕布)", () => {
  const S = (id: string, profileId = id): SessionMeta => ({ id, profileId, cwd: "/w" });

  it("并集按 id 去重:幕布引用的运行中会话不重复出现", () => {
    const sessions = [S("a", "omp"), S("b", "pi")];
    const out = watchedQuotaSessions(sessions, ["b", "a"]);
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("kept 死 id(tab 残留)找不到会话即忽略;空并集返回空", () => {
    expect(watchedQuotaSessions([], ["ghost"])).toEqual([]);
    expect(watchedQuotaSessions([S("a")], [])).toHaveLength(1);
  });
});

describe("pickBalanceWarning(余额低水位腿)", () => {
  it("低于下限报一次,同键去重;等于/高于不报", () => {
    const seen = new Set<string>();
    expect(pickBalanceWarning(5, 10, "p:bal:1", seen)).toBe(true);
    expect(pickBalanceWarning(4, 10, "p:bal:1", seen)).toBe(false); // 同小时桶已报
    expect(pickBalanceWarning(10, 10, "p:bal:2", seen)).toBe(false); // 等于下限不报
    expect(pickBalanceWarning(20, 10, "p:bal:2", seen)).toBe(false);
  });

  it("below<=0(关)/无数值(非 deepseek/relay)不参与", () => {
    const seen = new Set<string>();
    expect(pickBalanceWarning(0, 0, "k", seen)).toBe(false);
    expect(pickBalanceWarning(undefined, 10, "k", seen)).toBe(false);
    expect(seen.size).toBe(0);
  });

  it("新小时桶可再报(键随越线小时翻新,持续低水位每小时至多一条)", () => {
    const seen = new Set<string>();
    expect(pickBalanceWarning(5, 10, "p:bal:1", seen)).toBe(true);
    expect(pickBalanceWarning(5, 10, "p:bal:2", seen)).toBe(true);
  });
});

describe("pickResetWarning(claude 窗口重置腿)", () => {
  const NOW = Date.parse("2026-10-18T12:00:00Z");

  it("距重置不足 N 分钟告警,同 resetAt 键去重", () => {
    const seen = new Set<string>();
    const soon = NOW + 20 * 60_000; // 20 分钟后
    expect(pickResetWarning(soon, NOW, 30, "claude:reset:1", seen)).toBe(true);
    expect(pickResetWarning(soon + 1, NOW, 30, "claude:reset:1", seen)).toBe(false);
    expect(pickResetWarning(soon + 1, NOW, 30, "claude:reset:2", seen)).toBe(true); // 新 resetAt = 新周期
  });

  it("超出提醒提前量/无推算/分钟数<=0 不报", () => {
    const seen = new Set<string>();
    expect(pickResetWarning(NOW + 60 * 60_000, NOW, 30, "k1", seen)).toBe(false); // 还有 60 分
    expect(pickResetWarning(null, NOW, 30, "k2", seen)).toBe(false);
    expect(pickResetWarning(NOW + 10 * 60_000, NOW, 0, "k3", seen)).toBe(false);
    expect(seen.size).toBe(0);
  });
});
