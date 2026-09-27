/**
 * notify 纯逻辑契约测试:发送闸(分类开关 × 窗口聚焦)与文案、额度阈值判定。
 * 模块级纯函数,直接 import 无需环境桩。
 */
import { describe, expect, it } from "vitest";
import { notifyText, shouldNotify } from "./logic";
import { pickQuotaWarnings } from "./quotaWatch";

const PREFS = { notifyOsAsk: true, notifyOsTurnEnd: true, notifyOsSessionExit: false };

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
    const off = { notifyOsAsk: false, notifyOsTurnEnd: false, notifyOsSessionExit: true };
    expect(shouldNotify("ask", off, false)).toBe(false);
    expect(shouldNotify("turnEnd", off, false)).toBe(false);
    expect(shouldNotify("exit", off, false)).toBe(true);
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

describe("pickQuotaWarnings(额度阈值判定)", () => {
  const W = (label: string, pct: number, resetsAt?: number) => ({ label, displayPercent: pct, resetsAt });
  const labels = (ws: Array<{ label: string }>) => ws.map((w) => w.label);

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
