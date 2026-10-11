/** dateTitle 测试:格式器缓存必须按 language+opts 分键(B1 评审 P1 回归——
 * 曾只按 language 缓存,月标题/周首行/日标题三者串台,en/ja 全挂)。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@kernel/settings", () => ({
  getSettingsState: () => ({ settings: { language: "en" } }),
}));

interface DateTitleModule {
  weekdayLabelsMon: () => string[];
  dayTitleOf: (y: number, m: number, d: number) => string;
  monthTitleOf: (y: number, m: number) => string;
}

let mod: DateTitleModule;

beforeEach(async () => {
  vi.resetModules();
  mod = (await import("./dateTitle")) as unknown as DateTitleModule;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dateTitle(en)", () => {
  it("周首行是短星期名而非月标题(格式器不串台)", () => {
    /* 先触发月标题与日标题(不同 opts),再取周首行:缓存串台时这里会返回月标题。 */
    expect(mod.monthTitleOf(2026, 9)).toContain("2026");
    expect(mod.dayTitleOf(2026, 9, 16)).toContain("16");
    const labels = mod.weekdayLabelsMon();
    expect(labels).toHaveLength(7);
    /* en 短星期名不含数字(串台成 "September 2026" 会含 2026)。 */
    for (const l of labels) expect(l).not.toMatch(/2026/);
    expect(labels.join(",")).toMatch(/Mon/i);
  });

  it("同参数结果稳定", () => {
    expect(mod.dayTitleOf(2026, 9, 16)).toBe(mod.dayTitleOf(2026, 9, 16));
  });
});
