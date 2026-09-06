/**
 * 快捷键分发行为契约测试:terminal 作用域匹配、when 谓词穿透、
 * 聚焦期分发决策(resolveCommand)、分发器接线(拦截/穿透/退订)。
 * 模块级单例,每个用例经 vi.resetModules + 动态 import 取全新实例。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShortcutKeyEvent } from "./shortcuts";
import type * as ShortcutsNs from "./shortcuts";

type ShortcutsModule = typeof ShortcutsNs;

let sc: ShortcutsModule;

function keyEvent(key: string, extra?: Partial<ShortcutKeyEvent>): ShortcutKeyEvent {
  return { key, metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, ...extra };
}

beforeEach(async () => {
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  sc = await import("./shortcuts");
});

describe("terminal 作用域匹配 matchTerminalCommand", () => {
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

describe("installShortcutDispatcher 接线", () => {
  /** 最小 window/事件桩:捕获监听注册 + 可观测的 preventDefault/stopPropagation。 */
  function stubWindow(): { onKey: (e: KeyboardEvent) => void; offs: string[] } {
    let onKey: ((e: KeyboardEvent) => void) | undefined;
    const offs: string[] = [];
    vi.stubGlobal("window", {
      addEventListener: (_t: string, fn: (e: KeyboardEvent) => void) => {
        onKey = fn;
      },
      removeEventListener: () => offs.push("off"),
    });
    return { onKey: (e) => onKey!(e), offs };
  }

  function keyEvt(
    key: string,
    opts?: { isComposing?: boolean },
  ): KeyboardEvent & { prevented: boolean; stopped: boolean } {
    const evt = {
      isComposing: opts?.isComposing ?? false,
      key,
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      prevented: false,
      stopped: false,
      preventDefault() {
        evt.prevented = true;
      },
      stopPropagation() {
        evt.stopped = true;
      },
    };
    return evt as never;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("聚焦期 global 命中:run + 双拦截(事件到不了 xterm);terminal 作用域经分发器触发", () => {
    const { onKey } = stubWindow();
    sc.installShortcutDispatcher();
    let ranGlobal = false;
    let ranTerminal = false;
    sc.registerCommand({ id: "g.b", title: "B", keybinding: "Cmd+B", run: () => (ranGlobal = true) });
    sc.registerCommand({
      id: "t.f",
      title: "T",
      keybinding: "Cmd+F",
      scope: "terminal",
      run: () => (ranTerminal = true),
    });
    sc.setTerminalFocused(true);
    const b = keyEvt("b");
    onKey(b);
    expect(ranGlobal).toBe(true);
    expect(b.prevented && b.stopped).toBe(true);
    const f = keyEvt("f");
    onKey(f);
    expect(ranTerminal).toBe(true);
    expect(f.prevented && f.stopped).toBe(true);
  });

  it("聚焦期未命中:不动事件(键原样进 PTY);isComposing 全放行;退订生效", () => {
    const { onKey, offs } = stubWindow();
    const off = sc.installShortcutDispatcher();
    sc.registerCommand({ id: "g.k", title: "K", keybinding: "Cmd+K", run: () => undefined });
    sc.setTerminalFocused(true);
    const z = keyEvt("z");
    onKey(z);
    expect(z.prevented || z.stopped).toBe(false);
    const ime = keyEvt("a", { isComposing: true });
    onKey(ime);
    expect(ime.prevented || ime.stopped).toBe(false);
    off();
    expect(offs).toEqual(["off"]);
  });
});

describe("resolveCommand 分发决策", () => {
  it("非聚焦:terminal 作用域不可见(global 分发跳过 terminal 命令)", () => {
    sc.registerCommand({
      id: "t.k",
      title: "T",
      keybinding: "Cmd+K",
      scope: "terminal",
      run: () => undefined,
    });
    expect(sc.resolveCommand(keyEvent("k"))).toBeUndefined();
  });

  it("聚焦:terminal 作用域优先于同键 global;global 其他键照常命中", () => {
    sc.registerCommand({
      id: "g.f",
      title: "G",
      keybinding: "Cmd+F",
      when: () => false,
      run: () => undefined,
    });
    sc.registerCommand({
      id: "t.f",
      title: "T",
      keybinding: "Cmd+F",
      scope: "terminal",
      run: () => undefined,
    });
    sc.registerCommand({ id: "g.b", title: "B", keybinding: "Cmd+B", run: () => undefined });
    sc.setTerminalFocused(true);
    expect(sc.resolveCommand(keyEvent("f"))?.id).toBe("t.f");
    expect(sc.resolveCommand(keyEvent("b"))?.id).toBe("g.b");
  });

  it("聚焦:未命中返回 undefined(键穿透进 PTY);退出聚焦恢复 global-only", () => {
    sc.registerCommand({ id: "g.k", title: "G", keybinding: "Cmd+K", run: () => undefined });
    sc.setTerminalFocused(true);
    expect(sc.resolveCommand(keyEvent("z"))).toBeUndefined();
    sc.setTerminalFocused(false);
    expect(sc.resolveCommand(keyEvent("k"))?.id).toBe("g.k");
  });
});
