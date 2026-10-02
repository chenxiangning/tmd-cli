/**
 * 右栏面板渲染契约(react-dom/server 静态渲染,模式同 MonthView.test.tsx):
 * - 月导航 + 轴视图实体(原中央轴视图迁此):快照就绪渲染轴流(迷你月条
 *   日格数 = 当月天数,有记录日出卡),未就绪给加载行兜底;无打开主视图大按钮。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@kernel/i18n", () => ({ t: (k: string) => k }));
vi.mock("@kernel/workspace", () => ({ useWorkspaces: () => ({ list: [] }) }));
vi.mock("@kernel/workspaceOrigins", () => ({ findWorkspaceOrigin: () => null }));
vi.mock("./daySessions", () => ({
  useDaySessions: () => ({
    days: new Map([[`${H.key}-01`, [{ profileId: "omp", title: "s", startedAt: 0, modifiedAt: 0, live: false, wsName: "w" }]]]),
    progress: null,
  }),
  todayKey: () => `${H.key}-${H.dd}`,
}));
vi.mock("./holidays", () => ({ ensureHolidays: vi.fn(), useHolidays: () => null, holOf: () => null, isWorkdayOverride: () => false }));
vi.mock("./articleBody", () => ({ ArticleBody: () => <div />, NoteReadonly: () => <div /> }));

const H = vi.hoisted(() => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return { y, m, key: `${y}-${String(m).padStart(2, "0")}`, dd: String(now.getDate()).padStart(2, "0"), monthsEmpty: false };
});

vi.mock("./journalStore", () => {
  const snap = { articles: { "01": { title: "T", lede: "L", secs: [], open: [] } }, notes: {} };
  return {
    useJournalState: () => ({ ready: true, meta: { days: {} }, months: H.monthsEmpty ? {} : { [H.key]: snap } }),
    dayMetaOf: () => ({ beads: [], updatedAt: 0 }),
    deriveDayStatus: (article: unknown, isToday: boolean, n: number, meta?: { lastError?: string }) =>
      article ? (isToday ? "t" : "g") : meta?.lastError ? "f" : n > 0 ? "p" : "n",
    loadMonth: vi.fn(async () => undefined),
    /* 热力分档真函数(月条与月/年视图同源分位): */
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

import { JournalPanel } from "./JournalPanel";
import { monthTitleOf } from "./dateTitle";

function render(): string {
  return renderToStaticMarkup(createElement(JournalPanel));
}

describe("JournalPanel 右栏轴视图宿主", () => {
  it("快照就绪:月导航 + 轴流挂载,月条日格数 = 当月天数,有记录日出卡,无打开大按钮", () => {
    const html = render();
    const days = new Date(H.y, H.m, 0).getDate();
    expect(html).toContain(monthTitleOf(H.y, H.m));
    expect(html).toContain("dj-flow-root");
    expect(html.split("dj-mb-cell").length - 1).toBe(days);
    expect(html).toContain(`data-day="1"`);
    expect(html).not.toContain("dj-panel-open");
  });

  it("月条热力档挂 dj-mb- 前缀(此前裸 hN 类永不命中,生成日热力色静默失效)", () => {
    const html = render();
    /* 回归钉:裸类 class="dj-mb-cell hN" 不允许再出现 */
    expect(html).not.toMatch(/class="dj-mb-cell h\d"/);
    /* 当月 1 日有文章且有会话行 → 生成态必挂带前缀的热力档
       (单活跃日时阈值坍缩 [1,1,1],1 条记录判 h4 而非 h1;今日恰为 1 日则走 dj-mb-t) */
    if (H.dd !== "01") expect(html).toMatch(/dj-mb-cell dj-mb-(h[1-4]|t)/);
  });

  it("快照未就绪:加载行兜底,不渲染轴流", () => {
    H.monthsEmpty = true;
    const html = render();
    expect(html).toContain("正在加载…");
    expect(html).not.toContain("dj-flow-root");
  });
});
