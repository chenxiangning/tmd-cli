/**
 * 终端搜索命中计数契约(terminalMatchCount,042 随手带 n/m 计数):
 * 逐行扫描口径(跨行不命中)、大小写/正则选项、非法正则回落 0、
 * 零长命中(a* 类)不计、选区起点反推当前序号(1 基,无选区 = 0)。
 * 纯函数零 DOM,fixture 直造。
 */
import { describe, expect, it } from "vitest";
import { countTerminalMatches } from "./terminalMatchCount";

const LINES = ["hello world", "again HELLO there", "no match here"];

describe("countTerminalMatches", () => {
  it("逐行统计总命中;大小写不敏感(默认);跨行不命中", () => {
    expect(countTerminalMatches(LINES, "hello", { caseSensitive: false, regex: false })).toEqual({
      total: 2,
      current: 0,
    });
  });

  it("大小写敏感只计全等形态", () => {
    expect(
      countTerminalMatches(LINES, "HELLO", { caseSensitive: true, regex: false }),
    ).toEqual({ total: 1, current: 0 });
  });

  it("正则模式按 pattern 计;普通模式的元字符按字面量转义", () => {
    expect(countTerminalMatches(["a1 b22 c333"], "\\d+", { caseSensitive: false, regex: true })).toEqual({
      total: 3,
      current: 0,
    });
    /* 字面量点号:普通模式 1 处,正则模式「任意字符」2 处。 */
    expect(countTerminalMatches(["a.b axb"], "a.b", { caseSensitive: false, regex: false })).toEqual({
      total: 1,
      current: 0,
    });
    expect(countTerminalMatches(["a.b axb"], "a.b", { caseSensitive: false, regex: true })).toEqual({
      total: 2,
      current: 0,
    });
  });

  it("非法正则不抛错,回落 0 命中(与浮层 find 跳过口径一致)", () => {
    expect(countTerminalMatches(LINES, "([", { caseSensitive: false, regex: true })).toEqual({
      total: 0,
      current: 0,
    });
  });

  it("空查询 0 命中;零长命中(a*)不计", () => {
    expect(countTerminalMatches(LINES, "", { caseSensitive: false, regex: false })).toEqual({
      total: 0,
      current: 0,
    });
    /* "aa b" 中 a* 的非空命中只有 "aa";空串命中跳过。 */
    expect(countTerminalMatches(["aa b"], "a*", { caseSensitive: false, regex: true }).total).toBe(1);
  });

  it("选区起点反推当前序号:之前命中数 + 1;无选区 = 0;序号夹取总量", () => {
    const opts = { caseSensitive: false, regex: false };
    /* LINES 中 hello 命中:(0,0) 与 (1,6)。 */
    expect(countTerminalMatches(LINES, "hello", opts, { row: 0, col: 0 }).current).toBe(1);
    expect(countTerminalMatches(LINES, "hello", opts, { row: 1, col: 0 }).current).toBe(2);
    expect(countTerminalMatches(LINES, "hello", opts, { row: 1, col: 6 }).current).toBe(2);
    expect(countTerminalMatches(LINES, "hello", opts, { row: 2, col: 0 }).current).toBe(2);
    expect(countTerminalMatches(LINES, "hello", opts, null).current).toBe(0);
  });
});
