/** docgen 模板与周期测试(周/月键、区间含端、跨年周键)。 */
import { describe, expect, it } from "vitest";
import { DOCGEN_TEMPLATES, getDocGenTemplate, isoWeekKey, periodRange } from "./templates";

describe("templates", () => {
  it("内置模板清单:5 生成类 + analysis 纯提示词", () => {
    expect(DOCGEN_TEMPLATES).toHaveLength(6);
    expect(getDocGenTemplate("analysis")?.analysisOnly).toBe(true);
    expect(getDocGenTemplate("release")?.needsGit).toBe(true);
    expect(getDocGenTemplate("nonsense")).toBeUndefined();
  });
});

describe("periodRange", () => {
  it("本周:近 7 天含今天,键 = ISO 周", () => {
    const r = periodRange("本周", "2026-10-11");
    expect(r.key).toBe(isoWeekKey(new Date("2026-10-11")));
    expect(r.from).toBe("2026-10-05");
    expect(r.to).toBe("2026-10-11");
  });

  it("上周:整体前移 7 天", () => {
    const r = periodRange("上周", "2026-10-11");
    expect(r.from).toBe("2026-09-28");
    expect(r.to).toBe("2026-10-04");
  });

  it("本月:键 = 月,from = 1 号", () => {
    const r = periodRange("本月", "2026-10-11");
    expect(r.key).toBe("2026-10");
    expect(r.from).toBe("2026-10-01");
    expect(r.to).toBe("2026-10-11");
  });

  it("ISO 周键跨年:2026-01-01 属 2026-W01,2025-12-29 属同周", () => {
    expect(isoWeekKey(new Date("2026-01-01"))).toBe("2026-W01");
    expect(isoWeekKey(new Date("2025-12-29"))).toBe("2026-W01");
    expect(isoWeekKey(new Date("2026-12-31"))).toBe("2026-W53");
  });
});
