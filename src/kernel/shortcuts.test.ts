/**
 * 快捷键命令注册表行为契约测试。
 * 覆盖:重复 id/不可解析键位/Escape 抛错、同键冲突与 when 互斥放行、
 * match 自定义匹配、终端桥作用域隔离、when 异常穿透、formatKeybinding。
 * 模块级单例,每个用例经 vi.resetModules + 动态 import 取全新实例。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShortcutKeyEvent } from "./shortcuts";

type ShortcutsModule = typeof import("./shortcuts");

let sc: ShortcutsModule;

function keyEvent(key: string, extra?: Partial<ShortcutKeyEvent>): ShortcutKeyEvent {
  return { key, metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, ...extra };
}

beforeEach(async () => {
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  sc = await import("./shortcuts");
});

describe("registerCommand", () => {
  it("重复 id 注册即抛错", () => {
    sc.registerCommand({ id: "a.x", title: "X", run: () => undefined });
    expect(() =>
      sc.registerCommand({ id: "a.x", title: "X", run: () => undefined }),
    ).toThrow(/重复注册/);
  });

  it("裸键(无修饰键)不可解析即抛错", () => {
    expect(() =>
      sc.registerCommand({ id: "a.x", title: "X", keybinding: "K", run: () => undefined }),
    ).toThrow(/无法解析/);
  });

  it("Escape 禁绑", () => {
    expect(() =>
      sc.registerCommand({
        id: "a.x",
        title: "X",
        keybinding: "Cmd+Escape",
        run: () => undefined,
      }),
    ).toThrow(/Escape/);
  });

  it("同键且任一方无 when 抛错;双方都有 when 放行(⌘S 分家场景)", () => {
    sc.registerCommand({
      id: "a.save",
      title: "A",
      keybinding: "Cmd+S",
      run: () => undefined,
    });
    // 同键但仅一方有 when = 真冲突(消费语义无法保证互斥)
    expect(() =>
      sc.registerCommand({
        id: "b.save",
        title: "B",
        keybinding: "Cmd+S",
        when: () => true,
        run: () => undefined,
      }),
    ).toThrow(/重复绑定/);
  });

  it("双方都有 when 的同键放行(⌘S 按 tab kind 分家场景)", () => {
    sc.registerCommand({
      id: "a.save",
      title: "A",
      keybinding: "Cmd+S",
      when: () => true,
      run: () => undefined,
    });
    sc.registerCommand({
      id: "b.save",
      title: "B",
      keybinding: "Cmd+S",
      when: () => false,
      run: () => undefined,
    });
    expect(sc.getCommands().map((c) => c.id)).toEqual(["a.save", "b.save"]);
   });

  it("同键不同作用域互不冲突(终端桥 vs 全局分发器)", () => {
    sc.registerCommand({
      id: "t.find",
      title: "T",
      keybinding: "Cmd+F",
      scope: "terminal",
      run: () => undefined,
    });
    sc.registerCommand({
      id: "g.find",
      title: "G",
      keybinding: "Cmd+F",
      when: () => true,
      run: () => undefined,
    });
    expect(sc.getCommands().map((c) => c.id)).toEqual(["g.find", "t.find"]);
  });
});


describe("终端桥 matchTerminalCommand", () => {
  it("只匹配 terminal 作用域;global 命令不可见", () => {
    sc.registerCommand({
      id: "t.find",
      title: "搜索",
      keybinding: "Cmd+F",
      scope: "terminal",
      run: () => undefined,
    });
    sc.registerCommand({
      id: "g.other",
      title: "其他",
      keybinding: "Cmd+F",
      when: () => false,
      run: () => undefined,
    });
    expect(sc.matchTerminalCommand(keyEvent("f"))?.id).toBe("t.find");
  });

  it("未命中返回 undefined", () => {
    expect(sc.matchTerminalCommand(keyEvent("z"))).toBeUndefined();
  });
});

describe("when 谓词", () => {
  it("谓词异常按不满足处理(matchTerminalCommand 返回 undefined)", () => {
    sc.registerCommand({
      id: "t.boom",
      title: "B",
      keybinding: "Cmd+B",
      scope: "terminal",
      when: () => {
        throw new Error("boom");
      },
      run: () => undefined,
    });
    expect(sc.matchTerminalCommand(keyEvent("b"))).toBeUndefined();
  });
});

describe("match 自定义匹配", () => {
  it("match 命中且不参与键位冲突检查", () => {
    sc.registerCommand({
      id: "s.digit",
      title: "切会话",
      keybindingLabel: "⌘1-9",
      match: (e) => e.metaKey && /^[1-9]$/.test(e.key),
      run: () => undefined,
    });
    sc.registerCommand({
      id: "s.other",
      title: "O",
      keybinding: "Cmd+1",
      run: () => undefined,
    });
    expect(sc.getCommands().length).toBe(2); // match 命令不触发同键冲突
  });
});

describe("formatKeybinding", () => {
  it("修饰键转符号,普通键转大写", () => {
    expect(sc.formatKeybinding("Cmd+Shift+E")).toBe("⌘⇧E");
    expect(sc.formatKeybinding("Cmd+Alt+B")).toBe("⌘⌥B");
    expect(sc.formatKeybinding("Cmd+,")).toBe("⌘,");
  });
});
