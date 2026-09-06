/**
 * 快捷键命令注册表行为契约测试:注册冲突/平台修饰键分流/match/format。
 * 分发行为(作用域匹配/聚焦期分发决策/分发器接线)见 shortcuts.dispatch.test.ts。
 * 模块级单例,每个用例经 vi.resetModules + 动态 import 取全新实例(加载边界用例,静态导入取不到 reset 后实例)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as ShortcutsNs from "./shortcuts";
import type { ShortcutKeyEvent } from "./shortcuts";

type ShortcutsModule = typeof ShortcutsNs;

let sc: ShortcutsModule;

/** 可控平台(默认 unknown = 宽松兜底,既有用例行为不变)。 */
let platformKind: "macos" | "windows" | "linux" | "unknown" = "unknown";
vi.mock("./platform", () => ({
  getPlatformKind: () => platformKind,
}));

function keyEvent(key: string, extra?: Partial<ShortcutKeyEvent>): ShortcutKeyEvent {
  return { key, metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, ...extra };
}

beforeEach(async () => {
  platformKind = "unknown";
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

  it("同键不同作用域注册互不冲突(聚焦期由 resolveCommand 裁决:terminal 优先)", () => {
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


describe("平台修饰键分流(macOS 的 Ctrl+键不被全局快捷键劫持)", () => {
  it("macOS:Cmd+K 仅匹配 metaKey;Ctrl+K 穿透(留给终端/Emacs 键生态)", () => {
    platformKind = "macos";
    sc.registerCommand({
      id: "t.k",
      title: "K",
      keybinding: "Cmd+K",
      scope: "terminal",
      run: () => undefined,
    });
    expect(sc.matchTerminalCommand(keyEvent("k"))?.id).toBe("t.k");
    expect(
      sc.matchTerminalCommand(keyEvent("k", { metaKey: false, ctrlKey: true })),
    ).toBeUndefined();
  });

  it("Windows:Cmd+K 仅匹配 ctrlKey;metaKey 穿透", () => {
    platformKind = "windows";
    sc.registerCommand({
      id: "t.k",
      title: "K",
      keybinding: "Cmd+K",
      scope: "terminal",
      run: () => undefined,
    });
    expect(
      sc.matchTerminalCommand(keyEvent("k", { metaKey: false, ctrlKey: true }))?.id,
    ).toBe("t.k");
    expect(sc.matchTerminalCommand(keyEvent("k"))).toBeUndefined();
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

