/**
 * DayFlow 加载态契约:loading 期间渲染 Spinner + 加载中,不渲染上一日的旧数据头。
 * 手法同 Spinner.test(node renderToStaticMarkup)。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FpDayDetail } from "../dataSource";
import { DayFlow } from "./DayFlow";

const detail: FpDayDetail = {
  day: "2026-10-15",
  rollup: null,
  cards: [],
  cardsOrigin: null,
  aiCards: null,
  rows: [],
  article: null,
  commits: [],
  scanFailed: false,
};

const base = {
  detail,
  range: null,
  rangeDetails: [],
  query: "",
  today: "2026-10-20",
  focusIdx: -1,
  onOpenCard: () => {},
  onFix: () => {},
  onManualDigest: () => {},
  onAiDigest: () => {},
};

describe("DayFlow loading", () => {
  it("loading 期间显示加载态且不渲染旧日数据", () => {
    const html = renderToStaticMarkup(<DayFlow {...base} loading />);
    expect(html).toContain('role="status"');
    expect(html).toContain("加载中…");
    expect(html).not.toContain("2026-10-15");
  });

  it("非加载态照常渲染当日头", () => {
    const html = renderToStaticMarkup(<DayFlow {...base} />);
    expect(html).toContain("2026-10-15");
    expect(html).not.toContain("加载中…");
  });
});
