/** 节假日解析测试(负载形状/调休过滤/异形跳过/跨年剔除)。 */
import { describe, expect, it } from "vitest";
import { parseHolidayPayload } from "./holidays";

const PAYLOAD = {
  year: 2026,
  days: [
    { name: "元旦", date: "2026-01-01", isOffDay: true },
    { name: "元旦", date: "2026-01-02", isOffDay: true },
    { name: "春节", date: "2026-02-15", isOffDay: false }, /* 调休上班 */
    { name: "春节", date: "2026-02-17", isOffDay: true },
    { name: "坏条目", date: "not-a-date", isOffDay: true },
    { name: 42, date: "2026-05-01", isOffDay: true },
    { name: "跨年", date: "2025-12-31", isOffDay: true },
  ],
};

describe("parseHolidayPayload", () => {
  it("放假/调休分流:off 才留名,调休上班保留标记但不作休", () => {
    const f = parseHolidayPayload(2026, 1, PAYLOAD)!;
    expect(f.days["01-01"]).toEqual({ name: "元旦", off: true });
    expect(f.days["02-15"]).toEqual({ name: "春节", off: false });
    expect(f.days["02-17"]?.off).toBe(true);
  });

  it("坏条目跳过、跨年剔除、全空返 null", () => {
    const f = parseHolidayPayload(2026, 1, PAYLOAD)!;
    expect(f.days["05-01"]).toBeUndefined();
    expect(f.days["12-31"]).toBeUndefined();
    expect(parseHolidayPayload(2026, 1, { days: [] })).toBeNull();
    expect(parseHolidayPayload(2026, 1, null)).toBeNull();
    expect(parseHolidayPayload(2026, 1, { days: "x" })).toBeNull();
  });
});
