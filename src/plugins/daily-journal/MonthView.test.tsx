/**
 * 月格状态行渲染契约(react-dom/server 静态渲染,模式同 GenSettings.test.tsx):
 * - 格正文一律单行当日状态(生成状态 · 会话数),不再渲染文章标题/导语长文案;
 * - 失败日正文短句化,完整错误转 title 悬停;各状态行带状态色类;空日给便签引导。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@kernel/i18n", () => ({
  t: (k: string, p?: Record<string, string | number>) => k.replace(/\{(\w+)\}/g, (_, w) => String(p?.[w] ?? `{${w}}`)),
}));
vi.mock("@kernel/host", () => ({ host: { getCliProfiles: () => [] } }));
vi.mock("./journalTabs", () => ({ openArticleTab: vi.fn() }));
vi.mock("./taskQueue", () => ({ enqueueTask: vi.fn() }));
vi.mock("./holidays", () => ({ holOf: () => null, useHolidays: () => null }));

import { MonthView } from "./MonthView";
import type { DaySessionRow } from "./daySessions";
import type { Article } from "./articleParse";
import { setDayResult } from "./journalStore";

const Y = 2026;
const M = 9;
const key = (d: number) => `${Y}-${String(M).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const rows = (n: number): DaySessionRow[] =>
  Array.from({ length: n }, (_, i) => ({
    profileId: "omp",
    title: `s${i}`,
    startedAt: 0,
    modifiedAt: 0,
    live: false,
    wsName: "ws",
  }));

const article: Article = { title: "AI 生成的超长标题占位", lede: "AI 生成的超长导语占位", secs: [], open: [] };

function renderMonth(
  articles: Record<string, Article | null>,
  sessions: Map<string, DaySessionRow[]>,
  today: string,
  notes: Record<string, { text: string; images: never[]; updatedAt: number }> = {},
): string {
  return renderToStaticMarkup(
    createElement(MonthView, { ym: { y: Y, m: M }, snap: { articles, notes }, sessions, today }),
  );
}

describe("MonthView 月格单行状态描述", () => {
  it("已生成日:渲染「已生成 · n 条会话」,不再渲染文章标题/导语", () => {
    const html = renderMonth({ "01": article }, new Map([[key(1), rows(24)]]), key(30));
    expect(html).toContain("已生成 · 24 条会话");
    expect(html).not.toContain("超长标题占位");
    expect(html).not.toContain("超长导语占位");
  });

  it("今日已生成:状态行为增量中并带强调色", () => {
    const html = renderMonth({ "30": article }, new Map([[key(30), rows(12)]]), key(30));
    expect(html).toContain("增量中 · 12 条会话");
    expect(html).toContain("dj-accent");
  });

  it("待提取日:渲染「待提取 · n 条会话」并带警示色", () => {
    const html = renderMonth({ "02": null }, new Map([[key(2), rows(17)]]), key(30));
    expect(html).toContain("待提取 · 17 条会话");
    expect(html).toContain("dj-warn");
  });

  it("失败日:短句 + 完整错误转 title 悬停", () => {
    setDayResult(key(9), { lastError: "引擎超时:OMP spawn failed" });
    const html = renderMonth({ "09": null }, new Map([[key(9), rows(9)]]), key(30));
    expect(html).toContain("生成失败 · 9 条会话");
    expect(html).toContain(`title="引擎超时:OMP spawn failed"`);
    expect(html).not.toContain(">引擎超时:OMP spawn failed</div>");
  });

  it("空日:保留便签引导行;全月不再出现徽章与右上角计数", () => {
    const html = renderMonth({ "03": null }, new Map(), key(30));
    expect(html).toContain("无会话 · 点开写便签");
    expect(html).not.toContain("dj-badge");
    expect(html).not.toContain("dj-cell-sub");
  });

  it("有便签日:各状态行追加「有便签」标注,空日改「无会话 · 有便签」", () => {
    const note = { text: "记一笔\n第二行", images: [], updatedAt: 0 };
    const html = renderMonth(
      { "01": article, "03": null },
      new Map([
        [key(1), rows(24)],
        [key(2), rows(17)],
      ]),
      key(30),
      { "01": note, "02": note, "03": note },
    );
    expect(html).toContain("已生成 · 24 条会话 · 有便签");
    expect(html).toContain("待提取 · 17 条会话 · 有便签");
    expect(html).toContain("无会话 · 有便签");
    expect(html).not.toContain("dj-notemark");
  });
});
