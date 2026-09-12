/**
 * 输入历史 store 单测 —— 契约:记录去重置底/封顶 200/计数排序/删除清空/
 * 最佳 ghost 候选(前缀匹配,次数降序,同次数取更短)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __setStorageForTest,
  clearPromptHistory,
  deletePrompt,
  findPromptCompletion,
  getPromptHistory,
  getPromptHistoryWithCounts,
  recordPrompt,
  subscribePromptHistory,
} from "./promptHistory";

/** 极简 localStorage stub(node 环境无 Web Storage,循 filePanel.test 惯例)。 */
const backing = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, v),
  removeItem: (k: string) => void backing.delete(k),
});

afterEach(() => {
  backing.clear();
  __setStorageForTest(null);
});

describe("recordPrompt", () => {
  it("记录去重置底:重复提交移到最新", () => {
    recordPrompt("alpha");
    recordPrompt("beta");
    recordPrompt("alpha");
    expect(getPromptHistory()).toEqual(["beta", "alpha"]);
  });

  it("封顶 200 条:最旧被挤出", () => {
    for (let i = 0; i < 205; i++) recordPrompt(`p${i}`);
    const items = getPromptHistory();
    expect(items).toHaveLength(200);
    expect(items[0]).toBe("p5");
    expect(items[199]).toBe("p204");
  });

  it("空串与纯空白不入史;单条截断 300 字符", () => {
    recordPrompt("   ");
    recordPrompt("a".repeat(400));
    expect(getPromptHistory()).toEqual(["a".repeat(300)]);
  });

  it("计数累计:重复提交 count 递增", () => {
    recordPrompt("x");
    recordPrompt("x");
    expect(getPromptHistoryWithCounts()).toEqual([{ text: "x", count: 2 }]);
  });
});

describe("deletePrompt / clearPromptHistory", () => {
  it("删除单条连带计数;清空全部归零", () => {
    recordPrompt("keep");
    recordPrompt("gone");
    deletePrompt("gone");
    expect(getPromptHistory()).toEqual(["keep"]);
    clearPromptHistory();
    expect(getPromptHistory()).toEqual([]);
    expect(getPromptHistoryWithCounts()).toEqual([]);
  });
});

describe("findPromptCompletion", () => {
  it("前缀匹配(大小写不敏感)取更长项;次数优先,同次数取更短", () => {
    recordPrompt("Fix the login bug");
    recordPrompt("Fix the login bug with redirect");
    expect(findPromptCompletion("fix the")).toBe("Fix the login bug");
    recordPrompt("Fix the login bug with redirect"); // 拉升次数 → 次数优先胜出
    expect(findPromptCompletion("fix the")).toBe("Fix the login bug with redirect");
  });

  it("查询不足 2 字符返回 null;无匹配返回 null;完全等长不补", () => {
    recordPrompt("run tests");
    expect(findPromptCompletion("r")).toBeNull();
    expect(findPromptCompletion("nope")).toBeNull();
    expect(findPromptCompletion("run tests")).toBeNull();
  });
});

describe("subscribePromptHistory", () => {
  it("记录/删除/清空触发订阅,退订后不再触发", () => {
    let hits = 0;
    const unsub = subscribePromptHistory(() => hits++);
    recordPrompt("a");
    deletePrompt("a");
    clearPromptHistory();
    unsub();
    recordPrompt("b");
    expect(hits).toBe(3);
  });
});

describe("持久化", () => {
  it("写盘后可从 storage 复原(脏数据回落空表)", () => {
    recordPrompt("persisted");
    expect(backing.get("tmd.composer.promptHistory.v1")).toContain("persisted");
    __setStorageForTest(null); // 模拟缺失 → 空表
    expect(getPromptHistory()).toEqual([]);
    __setStorageForTest('{"items":["ok"],"counts":{"ok":1},"junk":true}');
    expect(getPromptHistory()).toEqual(["ok"]);
    __setStorageForTest("not json");
    expect(getPromptHistory()).toEqual([]);
  });
});
