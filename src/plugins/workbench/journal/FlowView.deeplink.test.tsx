/**
 * 轴视图日卡双向深链入口(2026-10-20 spec)静态渲染契约:
 * DayCard 头部「全文 ↗」旁必须常驻「足迹 ↗」(openFootprintTab 深链,带日 key)。
 * node 环境无 jsdom,点击链路由 1421 桩目检覆盖;此处守渲染在场性。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@kernel/i18n", () => ({
  t: (k: string) => k,
}));
vi.mock("./journalStore", () => ({
  dayMetaOf: () => ({ beads: [], updatedAt: 0 }),
  deriveDayStatus: () => "done",
  heatOf: () => 0,
  heatThresholds: () => [1, 2, 3],
  loadMonth: vi.fn(async () => {}),
  useJournalState: () => ({ meta: {} }),
}));
vi.mock("./holidays", () => ({
  holOf: () => null,
  isWorkdayOverride: () => false,
  useHolidays: () => {},
}));
vi.mock("./journalTabs", () => ({ openArticleTab: vi.fn() }));
vi.mock("@plugins/footprint/fpTab", () => ({ openFootprintTab: vi.fn() }));

import { FlowView } from "./FlowView";
import type { DaySessionRow } from "./daySessions";

describe("FlowView 日卡足迹深链入口", () => {
  it("有记录日的卡头同时渲染「全文 ↗」与「足迹 ↗」", () => {
    const row = { id: "s1", profileId: "omp", wsId: "ws1", startedAt: 0, live: false } as unknown as DaySessionRow;
    const html = renderToStaticMarkup(
      createElement(FlowView, {
        ym: { y: 2026, m: 10 },
        snap: { articles: {}, notes: {} },
        sessions: new Map([["2026-10-12", [row]]]),
        today: "2026-10-20",
      }),
    );
    expect(html).toContain("全文 ↗");
    expect(html).toContain("足迹 ↗");
  });
});
