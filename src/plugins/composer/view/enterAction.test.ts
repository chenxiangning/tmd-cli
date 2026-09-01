/**
 * Composer Enter 键行为判定契约测试。
 * 覆盖:两种 sendShortcut 模式 × shift/⌘/Ctrl 修饰键矩阵 + IME 组合中不拦截。
 */
import { describe, expect, it } from "vitest";
import { shouldSendOnEnter, type EnterKeyMods } from "./enterAction";

function mods(partial: Partial<EnterKeyMods> = {}): EnterKeyMods {
  return {
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    isComposing: false,
    ...partial,
  };
}

describe("shouldSendOnEnter / enter 模式(默认)", () => {
  it("裸 Enter 发送", () => {
    expect(shouldSendOnEnter(mods(), "enter")).toBe(true);
  });

  it("Shift+Enter 换行,不发送", () => {
    expect(shouldSendOnEnter(mods({ shiftKey: true }), "enter")).toBe(false);
  });

  it("IME 组合中 Enter 不拦截(交给输入法确认候选)", () => {
    expect(shouldSendOnEnter(mods({ isComposing: true }), "enter")).toBe(false);
  });
});

describe("shouldSendOnEnter / cmdOrCtrlEnter 模式", () => {
  it("裸 Enter 换行,不发送", () => {
    expect(shouldSendOnEnter(mods(), "cmdOrCtrlEnter")).toBe(false);
  });

  it("⌘+Enter 发送", () => {
    expect(shouldSendOnEnter(mods({ metaKey: true }), "cmdOrCtrlEnter")).toBe(
      true,
    );
  });

  it("Ctrl+Enter 发送", () => {
    expect(shouldSendOnEnter(mods({ ctrlKey: true }), "cmdOrCtrlEnter")).toBe(
      true,
    );
  });

  it("IME 组合中 ⌘+Enter 不拦截", () => {
    expect(
      shouldSendOnEnter(
        mods({ metaKey: true, isComposing: true }),
        "cmdOrCtrlEnter",
      ),
    ).toBe(false);
  });
});
