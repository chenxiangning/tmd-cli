/**
 * EditWatch 行为契约测试(审批线 events 归因的检测端)。
 *
 * 覆盖:标记命中(工具行/patch 头)、ANSI 剥离、跨分片行拼接、
 * 路径归一(绝对相对化/引号/./ 前缀)、不可信路径拒绝(~、逃逸、空)、
 * 轮内去重与 onUserWrite 开轮、会话隔离、未声明 marks 短路。
 */

import { describe, expect, it } from "vitest";
import { EditWatch, normalizeEditPath } from "./editWatch";

const CWD = "/Users/x/repo";
const MARKS = [
  /^\s*⏺\s+(?:Update|Write|NotebookEdit)\((.+)\)\s*$/,
  /^\s*\*\*\*\s+(?:Update|Add|Delete)\s+File:\s*(.+?)\s*$/,
];

describe("normalizeEditPath", () => {
  it("仓库相对路径原样(剥引号与 ./ 前缀)", () => {
    expect(normalizeEditPath("src/a.ts", CWD)).toBe("src/a.ts");
    expect(normalizeEditPath('"src/a.ts"', CWD)).toBe("src/a.ts");
    expect(normalizeEditPath("./src/a.ts", CWD)).toBe("src/a.ts");
    expect(normalizeEditPath(" src/a.ts ", CWD)).toBe("src/a.ts");
  });

  it("cwd 内绝对路径相对化;cwd 外拒绝", () => {
    expect(normalizeEditPath(`${CWD}/src/a.ts`, CWD)).toBe("src/a.ts");
    expect(normalizeEditPath("/etc/passwd", CWD)).toBeNull();
  });

  it("不可信路径拒绝:家目录 / 父级逃逸 / 空 / 盘符", () => {
    expect(normalizeEditPath("~/x/a.ts", CWD)).toBeNull();
    expect(normalizeEditPath("../outside.ts", CWD)).toBeNull();
    expect(normalizeEditPath("a/../../b.ts", CWD)).toBeNull();
    expect(normalizeEditPath("", CWD)).toBeNull();
    expect(normalizeEditPath(".", CWD)).toBeNull();
    expect(normalizeEditPath("C:\\x", CWD)).toBeNull();
  });
});

describe("EditWatch 检测", () => {
  it("工具行与 patch 头命中;Read/Bash/正文不命中", () => {
    const w = new EditWatch();
    expect(w.onOutput("s", "⏺ Update(src/a.ts)\n", CWD, MARKS)).toEqual(["src/a.ts"]);
    expect(w.onOutput("s", "⏺ Write(new.ts)\r\n", CWD, MARKS)).toEqual(["new.ts"]);
    expect(w.onOutput("s", "  *** Update File: src/b.rs\r\n", CWD, MARKS)).toEqual(["src/b.rs"]);
    expect(w.onOutput("s", "  *** Add File: /Users/x/repo/c.py\n", CWD, MARKS)).toEqual(["c.py"]);
    expect(w.onOutput("s", "⏺ Read(src/a.ts)\n", CWD, MARKS)).toEqual([]);
    expect(w.onOutput("s", "⏺ Bash(rm -rf x)\n", CWD, MARKS)).toEqual([]);
    expect(w.onOutput("s", "我们来 Update(src/a.ts) 一下\n", CWD, MARKS)).toEqual([]);
  });

  it("ANSI 转义剥离后命中;跨分片行拼接", () => {
    const w = new EditWatch();
    const ansi = "\u001b[32m⏺\u001b[0m Update(src/a.ts)";
    expect(w.onOutput("s", `${ansi}\n`, CWD, MARKS)).toEqual(["src/a.ts"]);
    // 标记行被切成两个分片
    const w2 = new EditWatch();
    expect(w2.onOutput("s", "⏺ Upda", CWD, MARKS)).toEqual([]);
    expect(w2.onOutput("s", "te(src/a.ts)\n", CWD, MARKS)).toEqual(["src/a.ts"]);
  });

  it("轮内去重;onUserWrite 开新轮重新计入", () => {
    const w = new EditWatch();
    expect(w.onOutput("s", "⏺ Write(a.ts)\n", CWD, MARKS)).toEqual(["a.ts"]);
    expect(w.onOutput("s", "⏺ Update(a.ts)\n", CWD, MARKS)).toEqual([]);
    w.onUserWrite("s");
    expect(w.onOutput("s", "⏺ Write(a.ts)\n", CWD, MARKS)).toEqual(["a.ts"]);
  });

  it("会话隔离与移除清理;未声明 marks 短路", () => {
    const w = new EditWatch();
    expect(w.onOutput("a", "⏺ Write(a.ts)\n", CWD, MARKS)).toEqual(["a.ts"]);
    expect(w.onOutput("b", "⏺ Write(a.ts)\n", CWD, MARKS)).toEqual(["a.ts"]);
    w.onSessionRemoved("a");
    expect(w.onOutput("a", "⏺ Write(a.ts)\n", CWD, MARKS)).toEqual(["a.ts"]);
    expect(w.onOutput("s", "⏺ Write(a.ts)\n", CWD, [])).toEqual([]);
    expect(w.onOutput("s", "⏺ Write(a.ts)\n", CWD, null)).toEqual([]);
  });
});
