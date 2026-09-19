/**
 * boardData 看板数据装配纯函数契约(useBoardSessions 为 React hook,按约跳过不测;
 * boardOverlayStore 单例开关另有 boardOverlayStore.test.ts):
 * - laneOf 泳道投影:idle 并入 running、ended-seen 并入 archived,其余恒等;
 * - BOARD_LANES 三道常量与五态投影完备性(每态必落三道之一);
 * - dayKeyOf 本地日 key(0 基月字面格式、同日本地时刻同键、跨本地零点换键);
 * - dayStartOf 本地零点归零(时刻字段全零、当日各时刻同起点、次日严格更大);
 * - hourOf 本地小时;
 * - monthTitle/dayTitle/weekdayLabels 语言随设置:zh 精确文案,en/ja 走 Intl,
 *   语言往返后格式器缓存不串味;
 * - engineColor 引擎色:确定性哈希,hsl 格式与亮度带恒定。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "@kernel/ipc";
import type { BoardState } from "./boardData";

vi.mock("@kernel/ipc", () => ({
  ipc: {
    sessionSpawn: vi.fn(async () => ({ id: "pty-x", pid: 1 })),
    sessionList: vi.fn(async () => [] as SessionMeta[]),
    sessionKill: vi.fn(async () => undefined),
    sessionWrite: vi.fn(async () => undefined),
    sessionResize: vi.fn(async () => undefined),
  },
  onPtyOutput: vi.fn(async () => () => undefined),
  onPtyExit: vi.fn(async () => () => undefined),
}));

import { updateSettings } from "@kernel/settings";
import {
  BOARD_LANES,
  dayKeyOf,
  dayStartOf,
  engineColor,
  hourOf,
  laneOf,
  monthTitle,
  dayTitle,
  weekdayLabels,
} from "./boardData";

const ALL_STATES: BoardState[] = ["running", "idle", "ended-new", "ended-seen", "archived"];

beforeEach(() => {
  updateSettings({ language: "zh" });
});

describe("laneOf 泳道投影(2026-09-18 定稿三道)", () => {
  it("idle 并入 running、ended-seen 并入 archived,其余恒等", () => {
    expect(laneOf("idle")).toBe("running");
    expect(laneOf("ended-seen")).toBe("archived");
    expect(laneOf("running")).toBe("running");
    expect(laneOf("ended-new")).toBe("ended-new");
    expect(laneOf("archived")).toBe("archived");
  });

  it("投影完备:五态每态都落 BOARD_LANES 三道之一", () => {
    expect(BOARD_LANES.map((l) => l.key)).toEqual(["running", "ended-new", "archived"]);
    for (const st of ALL_STATES) {
      expect(BOARD_LANES.some((l) => l.key === laneOf(st))).toBe(true);
    }
  });
});

describe("本地日分界(非 UTC)", () => {
  it("dayKeyOf:0 基月字面格式,同日本地时刻同键,跨本地零点换键", () => {
    expect(dayKeyOf(new Date(2026, 8, 16, 23, 59).getTime())).toBe("2026-8-16");
    expect(dayKeyOf(new Date(2026, 8, 16, 0, 0).getTime())).toBe("2026-8-16");
    expect(dayKeyOf(new Date(2026, 8, 17, 0, 0).getTime())).toBe("2026-8-17");
    expect(dayKeyOf(new Date(2026, 11, 31, 12).getTime())).toBe("2026-11-31");
  });

  it("dayStartOf:时刻字段归零,当日各时刻同起点,次日严格更大", () => {
    const start = dayStartOf(new Date(2026, 8, 16, 15, 30, 45, 678).getTime());
    const d = new Date(start);
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([0, 0, 0, 0]);
    expect(dayStartOf(new Date(2026, 8, 16, 0, 0, 0, 1).getTime())).toBe(start);
    expect(start).toBeLessThanOrEqual(new Date(2026, 8, 16, 23, 59).getTime());
    expect(dayStartOf(new Date(2026, 8, 17, 0, 0).getTime())).toBeGreaterThan(start);
  });

  it("hourOf:本地小时", () => {
    expect(hourOf(new Date(2026, 8, 16, 14, 30).getTime())).toBe(14);
    expect(hourOf(new Date(2026, 8, 16, 0, 5).getTime())).toBe(0);
  });
});

describe("本地化标题(语言随设置)", () => {
  const ts = new Date(2026, 8, 16, 15, 0).getTime(); /* 2026-09-16 周三 */

  it("monthTitle:zh 精确文案,en/ja 走 Intl 输出对应语言", () => {
    expect(monthTitle(2026, 8)).toBe("2026 年 9 月");
    updateSettings({ language: "en" });
    const en = monthTitle(2026, 8);
    expect(en).toContain("September");
    expect(en).toContain("2026");
    updateSettings({ language: "ja" });
    const ja = monthTitle(2026, 8);
    expect(ja).toContain("2026");
    expect(ja).toContain("9月");
  });

  it("dayTitle:zh 精确文案,en/ja 切换生效", () => {
    expect(dayTitle(ts)).toBe("9 月 16 日 周三");
    updateSettings({ language: "en" });
    const en = dayTitle(ts);
    expect(en).toContain("Sep");
    expect(en).toContain("16");
    expect(en).toContain("Wed");
    updateSettings({ language: "ja" });
    const ja = dayTitle(ts);
    expect(ja).toContain("9月16日");
    expect(ja).toContain("水");
  });

  it("weekdayLabels:zh 固定七字,en/ja 起止为周日/周六", () => {
    expect(weekdayLabels()).toEqual(["日", "一", "二", "三", "四", "五", "六"]);
    updateSettings({ language: "en" });
    const en = weekdayLabels();
    expect(en).toHaveLength(7);
    expect(en[0]).toBe("Sun");
    expect(en[6]).toBe("Sat");
    updateSettings({ language: "ja" });
    const ja = weekdayLabels();
    expect(ja).toHaveLength(7);
    expect(ja[0]).toBe("日");
    expect(ja[6]).toBe("土");
  });

  it("语言 zh→en→zh 往返:格式器按语言缓存不串味", () => {
    expect(monthTitle(2026, 8)).toBe("2026 年 9 月");
    updateSettings({ language: "en" });
    expect(monthTitle(2026, 8)).toContain("September");
    updateSettings({ language: "zh" });
    expect(monthTitle(2026, 8)).toBe("2026 年 9 月");
  });
});

describe("engineColor 引擎色", () => {
  it("同 id 恒定,格式 hsl(<hue> 52% 48%) 且色相落在 [0,360)", () => {
    expect(engineColor("claude")).toBe(engineColor("claude"));
    for (const id of ["claude", "codex", "omp", "x"]) {
      const m = /^hsl\((\d+) 52% 48%\)$/.exec(engineColor(id));
      expect(m, `engineColor(${id}) 格式`).not.toBeNull();
      expect(Number(m![1])).toBeLessThan(360);
    }
  });
});
