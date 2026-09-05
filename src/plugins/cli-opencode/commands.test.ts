/**
 * opencode 命令候选单测 —— 内置表形状与「自定义覆盖内置」合并语义。
 */
import { describe, expect, it } from "vitest";
import {
  mergeOpencodeSuggestions,
  OPENCODE_COMMAND_SUGGESTIONS,
} from "./commands";

describe("OPENCODE_COMMAND_SUGGESTIONS(内置表形状)", () => {
  it("value 唯一且每项显式 action(无默认歧义)", () => {
    const values = OPENCODE_COMMAND_SUGGESTIONS.map((s) => s.value);
    expect(new Set(values).size).toBe(values.length);
    for (const item of OPENCODE_COMMAND_SUGGESTIONS) {
      expect(item.action, `${item.value} 缺 action`).toBeDefined();
    }
  });

  it("send/insert 初判分区:editor/exit/undo/redo 必须 insert(误触代价高)", () => {
    const byValue = new Map(OPENCODE_COMMAND_SUGGESTIONS.map((s) => [s.value, s]));
    for (const risky of ["editor", "exit", "undo", "redo"]) {
      expect(byValue.get(risky)?.action).toBe("insert");
    }
    expect(byValue.get("new")?.action).toBe("send");
  });
});

describe("mergeOpencodeSuggestions(自定义覆盖内置)", () => {
  it("同名自定义覆盖内置;内置独有项保留", () => {
    const merged = mergeOpencodeSuggestions(
      [{ value: "init", description: "我的初始化", action: "insert" }],
      [
        { value: "init", description: "官方", action: "send" },
        { value: "new", description: "新建", action: "send" },
      ],
    );
    const byValue = new Map(merged.map((s) => [s.value, s]));
    expect(byValue.get("init")).toEqual({
      value: "init",
      description: "我的初始化",
      action: "insert",
    });
    expect(byValue.get("new")).toEqual({ value: "new", description: "新建", action: "send" });
    expect(merged).toHaveLength(2);
  });
});
