/**
 * JournalTab 三视图契约(react-dom/server 静态渲染,模式同 MonthView.test.tsx):
 * - 视图 seg 含 年/月/轴 三钮,持久化恢复轴视图(localStorage 桩);
 * - 轴视图(自右栏面板收编,2026-10-11):迷你月条日格数 = 当月天数,
 *   有记录日出日卡;月视图恢复缺省不受轴视图影响。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@kernel/i18n", () => ({ t: (k: string) => k }));
vi.mock("@kernel/workspace", () => ({ useWorkspaces: () => ({ list: [] }) }));
vi.mock("@kernel/workspaceOrigins", () => ({ findWorkspaceOrigin: () => null, registerWorkspaceOrigin: () => () => {} }));
vi.mock("./journalTabs", () => ({ openArticleTab: vi.fn(), installArticleOpenGate: vi.fn() }));
vi.mock("./taskQueue", () => ({ useGenTasks: () => [] }));
vi.mock("./journalSchedule", () => ({ fillPendingDays: () => ({ queued: 0, remaining: 0 }) }));
vi.mock("./TaskPanel", () => ({ TaskPanel: () => <div /> }));
vi.mock("./GenSettings", () => ({ GenSettings: () => <div /> }));

const H = vi.hoisted(() => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return { y, m, key: `${y}-${String(m).padStart(2, "0")}` };
});

vi.mock("./daySessions", () => ({
  useDaySessions: () => ({
    days: new Map([[`${H.key}-01`, [{ profileId: "omp", title: "s", startedAt: 0, modifiedAt: 0, live: false, wsName: "w" }]]]),
    progress: null,
  }),
  todayKey: () => `${H.key}-01`,
  isRowSummarized: () => false,
}));
vi.mock("./holidays", () => ({ ensureHolidays: vi.fn(), useHolidays: () => ({ status: "cached" }), holOf: () => null, isWorkdayOverride: () => false }));
vi.mock("./articleBody", () => ({ ArticleBody: () => <div />, NoteReadonly: () => <div /> }));

vi.mock("./journalStore", () => {
  const snap = { articles: { "01": { title: "T", lede: "L", secs: [], open: [] } }, notes: {} };
  return {
    useJournalState: () => ({ ready: true, meta: { days: {} }, months: { [H.key]: snap }, config: { holidaysOn: false } }),
    dayMetaOf: () => ({ beads: [], updatedAt: 0 }),
    deriveDayStatus: (article: unknown, isToday: boolean, n: number, meta?: { lastError?: string }) =>
      article ? (isToday ? "t" : "g") : meta?.lastError ? "f" : n > 0 ? "p" : "n",
    loadMonth: vi.fn(async () => undefined),
    heatThresholds: (counts: number[]) => {
      const xs = [...new Set(counts.filter((c) => c > 0))].sort((a, b) => a - b);
      if (!xs.length) return [1, 2, 3] as const;
      const at = (p2: number) => xs[Math.min(xs.length - 1, Math.floor(p2 * xs.length))];
      return [at(0.25), at(0.5), at(0.75)] as const;
    },
    heatOf: (n: number, ts: readonly [number, number, number]) =>
      !n ? "" : n >= ts[2] ? "h4" : n >= ts[1] ? "h3" : n >= ts[0] ? "h2" : "h1",
  };
});

import { JournalTab } from "./JournalTab";

function render(view: string | null): string {
  vi.stubGlobal("localStorage", { getItem: () => view, setItem: () => {} });
  const html = renderToStaticMarkup(createElement(JournalTab));
  vi.unstubAllGlobals();
  return html;
}

describe("JournalTab 三视图(年/月/轴)", () => {
  it("seg 三钮齐备,轴视图选中态随持久化恢复(年/月钮未选中)", () => {
    const html = render("f");
    for (const label of ["年视图", "月视图", "轴视图"]) expect(html).toContain(label);
    expect(html).toMatch(/aria-selected="true"[^>]*>轴视图/);
    expect(html).toMatch(/aria-selected="false"[^>]*>年视图/);
    expect(html).toMatch(/aria-selected="false"[^>]*>月视图/);
  });

  it("轴视图:月条日格数 = 当月天数,有记录日出卡", () => {
    const html = render("f");
    const days = new Date(H.y, H.m, 0).getDate();
    expect((html.match(/dj-mb-cell/g) ?? []).length).toBe(days);
    expect(html).toContain("dj-flow");
    expect(html).toContain('class="dj-day"');
  });

  it("无持久化回落月视图(缺省不漂移)", () => {
    const html = render(null);
    expect(html).toContain('class="dj-month"'); /* MonthView 根;非工具栏 dj-month-title */
    expect(html).not.toContain("dj-flow-root"); /* 轴视图未挂载 */
  });
});
