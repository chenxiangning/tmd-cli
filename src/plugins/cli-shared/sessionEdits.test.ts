/**
 * cli-shared 会话尾窗与面板标记契约测试(主文件 sessionEdits,并入 askMarks/echoMarks)。
 * 覆盖契约:
 * - parseEditEventsFromText(纯函数):水位线只收 ts 严格大于 sinceTs 的事件且保序;
 *   lineFilter 不过的行不进 JSON 解析;尾窗截断的坏行跳过不致命(宁漏勿误);
 *   单行多事件全收(一次工具调用多文件写入);
 * - readEditsTail:path null(文件未生成)回 [] 且不发起尾读;尾读失败回 null
 *   (调用方保水位线重试,不误判零事件);成功按 2MB 尾窗预算读并原样透传 parse 入参;
 * - PI_TUI_ASK_MARKS:Ask 面板标题/页脚提示/自定义选项尾行命中(含单数与整行变体),
 *   普通输出不误报(纪律:宁漏勿误);
 * - PI_TUI_ECHO_MARKS:斜体 SGR 起始 + 字面双引号命中(含 truecolor 多参数变体),
 *   非斜体/无引号/裸文本不误报。
 *
 * 被测三模块皆无模块级状态,静态导入即可;ipc 走 mock。
 */
import { describe, expect, it, vi } from "vitest";
import type { CliSessionEdit } from "@kernel/cli";
import { EDITS_TAIL_BYTES, parseEditEventsFromText, readEditsTail } from "./sessionEdits";
import { PI_TUI_ASK_MARKS } from "./askMarks";
import { PI_TUI_ECHO_MARKS } from "./echoMarks";

const ipcMock = vi.hoisted(() => ({
  fsReadTail: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

/* 代表性适配器:lineFilter 按行特征字预筛,eventsOf 抽一行内的全部写入事件。 */
const lineFilter = (line: string) => line.includes('"edit"');
const eventsOf = (entry: Record<string, unknown>, cwd: string): CliSessionEdit[] =>
  (Array.isArray(entry.writes) ? (entry.writes as { p: string }[]) : []).map((w) => ({
    path: `${cwd}/${w.p}`,
    ts: entry.ts as number,
  }));

describe("parseEditEventsFromText", () => {
  it("水位线:只收 ts 严格大于 sinceTs 的事件,跨行保序", () => {
    const text = [
      JSON.stringify({ ts: 100, edit: 1, writes: [{ p: "a.ts" }] }),
      JSON.stringify({ ts: 150, edit: 1, writes: [{ p: "b.ts" }] }),
      JSON.stringify({ ts: 150, edit: 1, writes: [{ p: "c.ts" }] }),
    ].join("\n");
    expect(parseEditEventsFromText(text, 100, "/repo", lineFilter, eventsOf)).toEqual([
      { path: "/repo/b.ts", ts: 150 },
      { path: "/repo/c.ts", ts: 150 },
    ]);
  });

  it("lineFilter 不过的行不进解析;截断坏行与非法 JSON 跳过不致命", () => {
    const text = [
      /* 含 writes 但缺特征字:被预筛拦下,不产出事件 */
      JSON.stringify({ ts: 200, writes: [{ p: "x.ts" }] }),
      /* 尾窗截断的半行 JSON 与纯垃圾行 */
      '{"ts":200,"edit":1,"writes":[{"p":"y.ts"}',
      "not-json-at-all",
      JSON.stringify({ ts: 210, edit: 1, writes: [{ p: "z.ts" }] }),
    ].join("\n");
    expect(parseEditEventsFromText(text, 0, "/repo", lineFilter, eventsOf)).toEqual([
      { path: "/repo/z.ts", ts: 210 },
    ]);
  });

  it("单行多事件全收:一次工具调用多文件写入按序产出", () => {
    const text = JSON.stringify({ ts: 300, edit: 1, writes: [{ p: "a.ts" }, { p: "b.ts" }] });
    expect(parseEditEventsFromText(text, 0, "/repo", lineFilter, eventsOf)).toEqual([
      { path: "/repo/a.ts", ts: 300 },
      { path: "/repo/b.ts", ts: 300 },
    ]);
  });
});

describe("readEditsTail", () => {
  it("path null(文件未生成)回 [],不发起尾读", async () => {
    await expect(readEditsTail(null, 5, "/repo", () => [{ path: "x", ts: 1 }])).resolves.toEqual([]);
    expect(ipcMock.fsReadTail).not.toHaveBeenCalled();
  });

  it("尾读失败回 null:调用方保水位线重试,不误判为零事件", async () => {
    ipcMock.fsReadTail.mockRejectedValue(new Error("EIO"));
    await expect(readEditsTail("/s.jsonl", 5, "/repo", () => [])).resolves.toBeNull();
  });

  it("成功路径:按 2MB 预算读尾窗,尾文本/水位线/cwd 原样透传 parse", async () => {
    ipcMock.fsReadTail.mockResolvedValue('{"ts":9}');
    const parse = vi.fn(() => [{ path: "/repo/a.ts", ts: 9 }]);
    const out = await readEditsTail("/s.jsonl", 5, "/repo", parse);
    expect(ipcMock.fsReadTail).toHaveBeenCalledWith("/s.jsonl", EDITS_TAIL_BYTES);
    expect(parse).toHaveBeenCalledWith('{"ts":9}', 5, "/repo");
    expect(out).toEqual([{ path: "/repo/a.ts", ts: 9 }]);
  });

  it("尾窗预算常量为 2MB(四家适配器共享同一数值契约)", () => {
    expect(EDITS_TAIL_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe("PI_TUI_ASK_MARKS", () => {
  const hit = (line: string) => PI_TUI_ASK_MARKS.some((re) => re.test(line));

  it("Ask 面板标题行/页脚提示/自定义选项尾行命中(含单数与整行变体)", () => {
    expect(hit("Ask 3 questions?")).toBe(true);
    expect(hit("Ask 1 question?")).toBe(true);
    expect(hit("Enter select · n note · ↑/↓ move · Tab/←/→ · Esc cancel")).toBe(true);
    expect(hit("Esc cancel")).toBe(true);
    expect(hit("Esc to cancel")).toBe(true);
    expect(hit("❯ Other (type your own)")).toBe(true);
  });

  it("普通输出不误报(纪律:宁漏勿误)", () => {
    expect(hit("Ask me anything")).toBe(false);
    expect(hit("Enter to select an option")).toBe(false);
    expect(hit("Escape cancels the dialog")).toBe(false);
  });
});

describe("PI_TUI_ECHO_MARKS", () => {
  const hit = (line: string) => PI_TUI_ECHO_MARKS.some((re) => re.test(line));

  it("斜体 SGR 起始 + 字面双引号命中;truecolor 多参数变体同样命中", () => {
    expect(hit('\u001b[3;2m"帮我看看这段报错"\u001b[0m')).toBe(true);
    expect(hit('\u001b[3;58;2;190;80;70m"带色斜体回显"')).toBe(true);
  });

  it("非斜体 SGR / 斜体但无引号 / 无 ANSI 的裸引号行不误报", () => {
    expect(hit('\u001b[0m"普通白字引号"')).toBe(false);
    expect(hit('\u001b[3;2m斜体但没引号')).toBe(false);
    expect(hit('"纯文本引号行,无 ANSI 前缀"')).toBe(false);
  });
});
