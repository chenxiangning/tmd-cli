/** docgen 排程判定测试(appointment 计算/周幂等闸/非法入参),零 IO。 */
import { describe, expect, it } from "vitest";
import { appointmentOf, scheduleFireDue } from "./schedule";

/** 2026-10-11 是周日(一周之末)。 */
const SUNDAY = new Date("2026-10-11T12:00:00");
const FRIDAY_BEFORE = new Date("2026-10-09T16:59:00");
const FRIDAY_AT = new Date("2026-10-09T17:00:00");
const SATURDAY_AFTER = new Date("2026-10-10T10:00:00");

describe("scheduleFireDue", () => {
  it("周五 17:00 排程:到点发,过点补,未到不发", () => {
    const cfg = { weekday: 5, time: "17:00" };
    expect(scheduleFireDue(FRIDAY_AT, cfg)).toBe(true);
    expect(scheduleFireDue(SATURDAY_AFTER, cfg)).toBe(true); /* 错过当周仍补 */
    expect(scheduleFireDue(FRIDAY_BEFORE, cfg)).toBe(false);
  });

  it("同周已发过(lastWeekKey)不重发", () => {
    const cfg = { weekday: 5, time: "17:00", lastWeekKey: "2026-W41" };
    expect(scheduleFireDue(SUNDAY, cfg)).toBe(false);
    expect(scheduleFireDue(SATURDAY_AFTER, cfg)).toBe(false);
  });

  it("非法入参防御:weekday 越界/时间坏值不发", () => {
    expect(scheduleFireDue(FRIDAY_AT, { weekday: 6, time: "17:00" })).toBe(false);
    expect(scheduleFireDue(FRIDAY_AT, { weekday: 0, time: "17:00" })).toBe(false);
  });
});

describe("appointmentOf", () => {
  it("本周周五 17:00:周日起算回落到本周五(已过 → due);周一未来到 → 未到", () => {
    expect(appointmentOf(SUNDAY, { weekday: 5, time: "17:00" }).getDate()).toBe(9);
    expect(appointmentOf(SUNDAY, { weekday: 5, time: "17:00" }).getHours()).toBe(17);
    const monday = new Date("2026-10-05T10:00:00");
    expect(appointmentOf(monday, { weekday: 5, time: "17:00" }).getDate()).toBe(9);
  });

  it("坏时间值回落 09:00", () => {
    expect(appointmentOf(FRIDAY_AT, { weekday: 5, time: "bad" }).getHours()).toBe(9);
  });
});
