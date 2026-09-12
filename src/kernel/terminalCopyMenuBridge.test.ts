/**
 * terminal.copyMenu 命令桥契约(2026-09-11):聚焦期 Cmd/Ctrl+C 命中桥接
 * (分发器拦截 = 零 PTY 字节的前提)、未聚焦穿透、平台映射(mac=meta/win=ctrl)、
 * run 经 ref 桶触发。模块级单例,vi.resetModules + 动态 import 取全新实例。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShortcutKeyEvent } from "./shortcuts";
import type * as ShortcutsNs from "./shortcuts";
import type * as BridgeNs from "./terminalCopyMenuBridge";
/** 可控平台(默认 unknown = 宽松兜底,既有用例行为不变)。 */
let platformKind: "macos" | "windows" | "linux" | "unknown" = "unknown";
vi.mock("./platform", () => ({
  getPlatformKind: () => platformKind,
}));

let sc: typeof ShortcutsNs;
let bridge: typeof BridgeNs;

function keyEvent(key: string, extra?: Partial<ShortcutKeyEvent>): ShortcutKeyEvent {
  return { key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...extra };
}
beforeEach(async () => {
  platformKind = "unknown";
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  sc = await import("./shortcuts");
  bridge = await import("./terminalCopyMenuBridge");
});

describe("terminal.copyMenu 命令桥", () => {
  it("注册为 terminal 作用域 ⌘C;聚焦期命中", () => {
    sc.setTerminalFocused(true);
    expect(sc.resolveCommand(keyEvent("c", { metaKey: true }))?.id).toBe("terminal.copyMenu");
  });

  it("macOS:Ctrl+C 穿透(留给 readline/终端生态);Windows:Ctrl+C 命中、Cmd+C 穿透", () => {
    sc.setTerminalFocused(true);
    platformKind = "macos";
    expect(sc.resolveCommand(keyEvent("c", { ctrlKey: true }))).toBeUndefined();
    platformKind = "windows";
    expect(sc.resolveCommand(keyEvent("c", { ctrlKey: true }))?.id).toBe("terminal.copyMenu");
    expect(sc.resolveCommand(keyEvent("c", { metaKey: true }))).toBeUndefined();
  });

  it("未聚焦:terminal 作用域不可见(⌘C 回落浏览器复制语义)", () => {
    expect(sc.resolveCommand(keyEvent("c", { metaKey: true }))).toBeUndefined();
  });

  it("run 经 ref 桶触发;空桶静默", () => {
    sc.setTerminalFocused(true);
     let fired = false;
    bridge.copyMenuRequestRef.current = () => (fired = true);
    sc.resolveCommand(keyEvent("c", { metaKey: true }))!.run();
    expect(fired).toBe(true);
    bridge.copyMenuRequestRef.current = null;
    expect(() => sc.resolveCommand(keyEvent("c", { metaKey: true }))!.run()).not.toThrow();
  });
});
