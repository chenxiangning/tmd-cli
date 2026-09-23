/**
 * 键盘工具条键表 = 线上 PTY 序列契约(发错键 = TUI 里错操作);
 * 审批 sheet 排序 = 进行中置顶 + 轮次倒序(新批在上)。
 */
import { describe, expect, it } from "vitest";
import { KEYS } from "./KeyToolbar";
import { sortBatches, type CkptLite } from "./CkptSheet";

const seq = (label: string) => KEYS.find((k) => k.label === label)?.seq;

describe("键表序列", () => {
  it("方向键不串位(←→↑↓ 各对应 CSI D/C/A/B)", () => {
    expect(seq("←")).toBe("\x1b[D");
    expect(seq("→")).toBe("\x1b[C");
    expect(seq("↑")).toBe("\x1b[A");
    expect(seq("↓")).toBe("\x1b[B");
  });
  it("esc/tab/ctrl-c/enter/翻页", () => {
    expect(seq("esc")).toBe("\x1b");
    expect(seq("tab")).toBe("\t");
    expect(seq("⌃c")).toBe("\x03");
    expect(seq("↵")).toBe("\r");
    expect(seq("Pg↑")).toBe("\x1b[5~");
    expect(seq("Pg↓")).toBe("\x1b[6~");
  });
});

const b = (over: Partial<CkptLite>): CkptLite => ({
  id: "x",
  index: 1,
  open: false,
  ts: 0,
  state: "pending",
  prompt: "",
  files: [],
  ...over,
});

describe("sortBatches", () => {
  it("open 置顶,其余按 index 倒序;不改动入参", () => {
    const input = [b({ id: "a", index: 3 }), b({ id: "o", index: 4, open: true }), b({ id: "z", index: 9 })];
    expect(sortBatches(input).map((x) => x.id)).toEqual(["o", "z", "a"]);
    expect(input.map((x) => x.id)).toEqual(["a", "o", "z"]);
  });
});
