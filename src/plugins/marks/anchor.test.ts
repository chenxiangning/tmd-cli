/**
 * 标记锚点纯逻辑行为契约测试。
 * 覆盖:指纹稳定性与区分度、重定位 exact/moved/lost、多候选上下文收敛、
 * 摘录截断。纯函数,无 IO 无模块单例,直接静态 import。
 */
import { describe, expect, it } from "vitest";
import { fingerprintRange, lineHash, markExcerpt, relocateMark, type Mark } from "./anchor";

const CODE = ["import { a } from 'a';", "", "export function f() {", "  return 1;", "}", "", "export const g = 2;"];

function makeMark(startLine: number, endLine: number, lines: readonly string[] = CODE): Mark {
  return {
    id: "m1",
    path: "/ws/a.ts",
    startLine,
    endLine,
    fingerprint: fingerprintRange(lines, startLine, endLine),
    excerpt: "",
    note: "",
    state: "pending",
    createdAt: 0,
  };
}

describe("指纹", () => {
  it("同一内容指纹稳定,不同内容区分", () => {
    expect(lineHash("const a = 1;")).toBe(lineHash("const a = 1;"));
    expect(lineHash("const a = 1;")).not.toBe(lineHash("const a = 2;"));
    /* 空行/重复行也逐行进指纹:1-2 与 2-3 区分 */
    expect(fingerprintRange(CODE, 1, 2).body).not.toBe(fingerprintRange(CODE, 2, 3).body);
  });

  it("上下文行含边界约定(首行无前一行 = 空串)", () => {
    expect(fingerprintRange(CODE, 1, 2).context.startsWith("|")).toBe(true);
    expect(fingerprintRange(CODE, 1, 2).context.endsWith(`|${lineHash(CODE[2])}`)).toBe(true);
  });
});

describe("重定位", () => {
  it("原位置未变 = exact(不改行号)", () => {
    const result = relocateMark(CODE, makeMark(3, 5), 3);
    expect(result).toEqual({ status: "exact", startLine: 3, endLine: 5 });
  });

  it("内容整体下移 = moved 到新位置", () => {
    const shifted = [...CODE.slice(0, 2), "// new", ...CODE.slice(2)];
    const result = relocateMark(shifted, makeMark(3, 5), 3);
    expect(result).toEqual({ status: "moved", startLine: 4, endLine: 6 });
  });

  it("窗口内无命中 = lost,行号保持原值不瞎指", () => {
    const rewritten = CODE.map((line) => `${line} // x`);
    const result = relocateMark(rewritten, makeMark(3, 5), 3);
    expect(result).toEqual({ status: "lost", startLine: 3, endLine: 5 });
  });

  it("重复内容多候选时上下文行收敛到正确位置", () => {
    const dup = ["// head", "  return 1;", "}", "// tail", "function h() {", "  return 1;", "}"];
    const mark = makeMark(6, 7, dup);
    const shifted = [...dup.slice(0, 1), "// inserted", ...dup.slice(1)];
    const result = relocateMark(shifted, mark, 3);
    expect(result).toEqual({ status: "moved", startLine: 7, endLine: 8 });
  });

  it("超出窗口的移动判 lost", () => {
    const far = [...CODE, ...Array.from({ length: 10 }, (_, i) => `// pad ${i}`)];
    const mark = makeMark(3, 5);
    const without = far.filter((_, i) => i < 2 || i > 4);
    const result = relocateMark(without, mark, 3);
    expect(result.status).toBe("lost");
  });
});

describe("摘录", () => {
  it("短区间全量,长区间截断并标行数", () => {
    expect(markExcerpt(CODE, 3, 4)).toBe("export function f() {\n  return 1;");
    expect(markExcerpt(CODE, 1, 7, 2)).toBe(
      `${CODE[0]}\n${CODE[1]}\n… 共 7 行`,
    );
  });
});
