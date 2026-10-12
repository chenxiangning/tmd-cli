/**
 * 工作台 · 执行记录排序与格式助手测试(自 workbenchPure.test.ts 拆出守 300 行铁则)。
 */

import { describe, expect, it } from "vitest";
import { sortUpdates } from "../kindLabels";

/* 执行记录排序:按解析时刻,不按字符串(2026-10-12 实证 UTC 带偏移与本地
 * 无偏移混排时字符串比较乱序)。混排数据运行时构造:naive 串按本地解析、
 * 偏移串按绝对时刻,三者的绝对先后(c < a < b)在任意时区下恒定。 */
const pad2 = (n: number) => String(n).padStart(2, "0");
const fmtIso = (d: Date, zoned: boolean) =>
  zoned
    ? d.toISOString().replace("Z", "+00:00")
    : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
const BASE = Date.UTC(2026, 9, 12, 13, 0, 0); /* 绝对锚点 13:00Z */
describe("sortUpdates(混合时区格式按发生时刻排序)", () => {
  const u = (id: string, at: string) => ({ id, at });
  const mixed = [
    u("a", fmtIso(new Date(BASE), false)), /* 本地无偏移 = 13:00Z */
    u("b", fmtIso(new Date(BASE + 25 * 60_000), true)), /* 13:25Z */
    u("c", fmtIso(new Date(BASE - 17 * 60_000), true)), /* 12:43Z */
  ];

  it("asc 正序按真实时刻,desc 倒序;不可解析落 0 沉底", () => {
    expect(sortUpdates(mixed, "asc").map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(sortUpdates(mixed, "desc").map((item) => item.id)).toEqual(["b", "a", "c"]);
    const broken = sortUpdates([u("x", "not-a-date"), u("y", "2026-10-12T10:00:00+08:00")], "asc");
    expect(broken.map((item) => item.id)).toEqual(["x", "y"]);
  });

  it("不改动入参数组", () => {
    const src = [u("a", "2026-10-12T21:00:00+08:00"), u("b", "2026-10-12T12:00:00+00:00")];
    sortUpdates(src, "asc");
    expect(src.map((item) => item.id)).toEqual(["a", "b"]);
  });
});
