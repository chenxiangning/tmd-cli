/**
 * opencode 命令候选单测 —— 内置表形状与自定义同名去重优先级。
 */
import { describe, expect, it } from "vitest";
import { dedupeOpencodeSuggestions, OPENCODE_COMMAND_SUGGESTIONS } from "./commands";

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

describe("dedupeOpencodeSuggestions(同名去重,低→高优先级)", () => {
  it("高优先级(靠后)覆盖低优先级:项目同名压过全局与 JSON", () => {
    const merged = dedupeOpencodeSuggestions([
      { value: "review", description: "JSON 版", action: "insert" },
      { value: "foo", description: "全局版", action: "insert" },
      { value: "review", description: "项目版", action: "insert" },
    ]);
    const byValue = new Map(merged.map((s) => [s.value, s]));
    expect(byValue.get("review")?.description).toBe("项目版");
    expect(byValue.get("foo")?.description).toBe("全局版");
    expect(merged).toHaveLength(2);
  });
});
