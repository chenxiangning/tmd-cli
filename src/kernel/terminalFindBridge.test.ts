/**
 * terminalFindBridge 契约(模块导入即登记):
 * 导入时向快捷键分发器注册 terminal.find 命令 —— id terminal.find、键 Cmd+F、
 * 作用域 terminal、标题「终端搜索」;命令 run 只经 findRequestRef 间接触发
 * (激活的组件实例写入,未写入时静默不抛)。
 * shortcuts 以捕获桩替代(注册发生在导入期,静态断言登记契约)。
 */
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ cmd: undefined as undefined | { run: () => void; [k: string]: unknown } }));

vi.mock("@kernel/shortcuts", () => ({
  registerCommand: (cmd: { run: () => void }) => {
    captured.cmd = cmd;
  },
}));

import { findRequestRef } from "./terminalFindBridge";

describe("terminalFindBridge", () => {
  it("导入即登记 terminal.find:键位与作用域契约", () => {
    expect(captured.cmd).toMatchObject({
      id: "terminal.find",
      title: "终端搜索",
      keybinding: "Cmd+F",
      scope: "terminal",
    });
  });

  it("run 经 findRequestRef 间接触发;未就位时静默不抛", () => {
    const trigger = vi.fn();
    findRequestRef.current = trigger;
    captured.cmd?.run();
    expect(trigger).toHaveBeenCalledTimes(1);

    findRequestRef.current = null;
    expect(() => captured.cmd?.run()).not.toThrow();
    expect(trigger).toHaveBeenCalledTimes(1);
  });
});
