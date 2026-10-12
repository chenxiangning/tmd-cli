/**
 * 工作台 · 执行记录排序与格式助手测试(自 workbenchPure.test.ts 拆出守 300 行铁则)。
 */

import { describe, expect, it } from "vitest";
import { sortUpdates } from "../kindLabels";

/* 执行记录排序:按解析时刻,不按字符串(2026-10-12 实证 UTC 带偏移与本地
 * 无偏移混排时字符串比较乱序)。 */
describe("sortUpdates(混合时区格式按发生时刻排序)", () => {
  const u = (id: string, at: string) => ({ id, at });
  /* UTC 带偏移 13:44+00:00 = 本地 21:44,晚于本地无偏移 21:35 */
  const mixed = [
    u("a", "2026-10-12T21:35:39.332"),
    u("b", "2026-10-12T13:44:25.336+00:00"),
    u("c", "2026-10-12T13:18:43.257+00:00"),
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
