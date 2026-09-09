/**
 * useComposerTriggers 纯决策函数测试(hook 的 React 装配层不经渲染测试):
 * pickReplacement 的 token 替换 / 落点计算(insertText 正文、char+value 回落、
 * onPick 源空串回收)、wakeInsert 注入计算、dismissRecovery 回收判定。
 * 模块级依赖(host / suggest 链)以空桩隔离,被测函数不触网。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@kernel/host", () => ({ host: { getSessions: () => [], getActiveSessionId: () => null } }));
vi.mock("../triggers/suggest", () => ({ lookupSuggestions: async () => [] }));

import { dismissRecovery, pickReplacement, wakeInsert } from "./useComposerTriggers";

const SPECS = [{ char: "/" }, { char: "!!" }, { char: "##" }];

describe("pickReplacement", () => {
  it("提示词:insertText 正文替换 token,落点 = 区间起点 + 正文长", () => {
    expect(pickReplacement("看 !!dep 谢谢", [2, 7], SPECS, { value: "dep", insertText: "部署正文" })).toEqual({
      next: "看 部署正文 谢谢",
      caret: 6,
    });
  });

  it("静态候选:无 insertText 回落 char + value", () => {
    expect(pickReplacement("/", [0, 1], SPECS, { value: "model" })).toEqual({ next: "/model", caret: 6 });
  });

  it("智能体:onPick 源 insertText 空串 = token 回收", () => {
    expect(pickReplacement("##cr", [0, 4], SPECS, { value: "cr", insertText: "" })).toEqual({ next: "", caret: 0 });
  });
});

describe("wakeInsert", () => {
  it("光标处注入触发符,注入后光标停在触发符之后", () => {
    expect(wakeInsert("abc", 1, "!!")).toEqual({ after: "a!!bc", caret: 3 });
  });

  it("空文本注入到末尾", () => {
    expect(wakeInsert("", 0, "##")).toEqual({ after: "##", caret: 2 });
  });
});

describe("dismissRecovery", () => {
  const auto = { before: "hello", after: "hello!!" };

  it("一字未改 → 回到注入前文本", () => {
    expect(dismissRecovery("hello!!", auto)).toBe("hello");
  });

  it("用户已输入 → 不回收(null)", () => {
    expect(dismissRecovery("hello!!x", auto)).toBeNull();
  });
});
