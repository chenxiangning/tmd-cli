/**
 * commitWindow 契约:窗口两端必须带 UTC 标记(Rust parse_iso 对 naive 串
 * 一律按 UTC 取值,前端发本地 naive 串 = 窗口平移时区差,2026-10-20 修)。
 */
import { describe, expect, it } from "vitest";
import { commitWindow } from "./dataSource";

describe("commitWindow", () => {
  it("两端都是 UTC 标记的 ISO 串(parse_iso 契约)", () => {
    const w = commitWindow("2026-10-20");
    expect(w.since).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
    expect(w.until).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
  });

  it("窗口覆盖完整自然日(含端点,跨度 86399s)", () => {
    const w = commitWindow("2026-10-20");
    const span = (Date.parse(w.until) - Date.parse(w.since)) / 1000;
    expect(span).toBe(86399);
  });
});
