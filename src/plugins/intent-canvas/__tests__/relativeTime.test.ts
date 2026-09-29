import { describe, expect, it, vi } from "vitest";
import { formatRelativeCanvasTime } from "../utils/relativeTime";

// 与 IntentCanvasManager.test.tsx 相同的 t mock 风格：保留 key 并替换参数。
function createT() {
  const t = vi.fn((key: string, params?: Record<string, unknown>) => {
    if (!params) {
      return key;
    }
    return Object.entries(params).reduce(
      (value, [name, replacement]) => `${value}[${name}=${String(replacement)}]`,
      key,
    );
  });
  return t;
}

const NOW = new Date(2026, 7, 13, 12, 0, 0); // 周四中午（本地）

describe("formatRelativeCanvasTime", () => {
  it("formats same-day updates as today with time", () => {
    const t = createT();
    const result = formatRelativeCanvasTime(new Date(2026, 7, 13, 10, 24).toISOString(), NOW, t);
    expect(result).toMatch(/^今天 \{time\}\[time=.+\]$/);
  });

  it("formats previous-day updates as yesterday", () => {
    const t = createT();
    const result = formatRelativeCanvasTime(new Date(2026, 7, 12, 23, 30).toISOString(), NOW, t);
    expect(result).toBe("昨天");
  });

  it("formats updates within 30 days as N days ago", () => {
    const t = createT();
    const result = formatRelativeCanvasTime(new Date(2026, 7, 10, 12, 0).toISOString(), NOW, t);
    expect(result).toBe("{count} 天前[count=3]");
  });

  it("formats older updates in the same year as a date without year", () => {
    const t = createT();
    const result = formatRelativeCanvasTime(new Date(2026, 4, 1, 12, 0).toISOString(), NOW, t);
    expect(result).toMatch(/^\{date\}\[date=.+\]$/);
    expect(result).not.toContain("2026");
  });

  it("includes the year for cross-year dates", () => {
    const t = createT();
    const result = formatRelativeCanvasTime(new Date(2025, 11, 20, 12, 0).toISOString(), NOW, t);
    expect(result).toContain("2025");
  });

  it("returns the raw value for unparseable input", () => {
    const t = createT();
    expect(formatRelativeCanvasTime("not-a-date", NOW, t)).toBe("not-a-date");
  });
});
