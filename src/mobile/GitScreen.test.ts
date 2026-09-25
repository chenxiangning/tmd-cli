/**
 * opReportText —— 远端操作报告 → 人话一行(三 op × 已最新/有变化全分支覆盖)。
 */
import { describe, expect, it } from "vitest";
import { opReportText } from "./gitModel";

const rpt = (over: Partial<Parameters<typeof opReportText>[1]> = {}) => ({
  upToDate: false,
  commits: 0,
  files: 0,
  insertions: 0,
  deletions: 0,
  refs: 0,
  ...over,
});

describe("opReportText", () => {
  it("fetch:refs 口径", () => {
    expect(opReportText("fetch", rpt({ refs: 3 }))).toContain("3 个远端引用");
  });
  it("push:commits 口径", () => {
    expect(opReportText("push", rpt({ commits: 5 }))).toContain("5 个提交");
  });
  it("pull:commits/files/± 口径", () => {
    expect(opReportText("pull", rpt({ commits: 2, files: 7, insertions: 30, deletions: 4 }))).toContain("+30/-4");
  });
  it("三 op 的 upToDate 同归「已是最新」", () => {
    const up = rpt({ upToDate: true });
    expect(opReportText("fetch", up)).toBe("已是最新");
    expect(opReportText("pull", up)).toBe("已是最新");
    expect(opReportText("push", up)).toBe("已是最新");
  });
});
