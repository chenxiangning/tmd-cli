/**
 * 快捷键改写覆盖层行为契约测试:default/effective/录制/冲突/录制闸门。
 * 模块级单例,每个用例经 vi.resetModules + 动态 import 取全新实例。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as OverridesNs from "./shortcutOverrides";
import type { ShortcutKeyEvent } from "./shortcuts";

type OverridesModule = typeof OverridesNs;
let ov: OverridesModule;
let sc: typeof import("./shortcuts");

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
  ov = await import("./shortcutOverrides");
  sc = await import("./shortcuts");
});

describe("getEffectiveKeybinding", () => {
  it("无 override 时走原 keybinding", () => {
    sc.registerCommand({ id: "g.t", title: "T", keybinding: "Cmd+B", run: () => undefined });
    expect(ov.getEffectiveKeybinding("g.t")).toBe("Cmd+B");
  });

  it("override 替换", () => {
    sc.registerCommand({ id: "g.t", title: "T", keybinding: "Cmd+B", run: () => undefined });
    ov.setShortcutOverrides({ "g.t": "Cmd+Shift+K" });
    expect(ov.getEffectiveKeybinding("g.t")).toBe("Cmd+Shift+K");
  });

  it("override 空串 = 显式解绑,返回 undefined", () => {
    sc.registerCommand({ id: "g.t", title: "T", keybinding: "Cmd+B", run: () => undefined });
    ov.setShortcutOverrides({ "g.t": "" });
    expect(ov.getEffectiveKeybinding("g.t")).toBeUndefined();
  });

  it("未注册 id 返回 undefined", () => {
    expect(ov.getEffectiveKeybinding("missing")).toBeUndefined();
  });

  it("match 型命令无 keybinding,返回 undefined", () => {
    sc.registerCommand({
      id: "g.m",
      title: "M",
      match: (e: ShortcutKeyEvent) => e.metaKey && /^[1-9]$/.test(e.key),
      run: () => undefined,
    });
    expect(ov.getEffectiveKeybinding("g.m")).toBeUndefined();
  });
});

describe("isShortcutRemappable", () => {
  it("有静态 keybinding 无 match → true", () => {
    sc.registerCommand({ id: "g.t", title: "T", keybinding: "Cmd+B", run: () => undefined });
    expect(ov.isShortcutRemappable("g.t")).toBe(true);
  });
  it("match 型 → false", () => {
    sc.registerCommand({
      id: "g.m",
      title: "M",
      keybindingLabel: "⌘1-9",
      match: (e: ShortcutKeyEvent) => e.metaKey && /^[1-9]$/.test(e.key),
      run: () => undefined,
    });
    expect(ov.isShortcutRemappable("g.m")).toBe(false);
  });
  it("无 keybinding(非 match)→ false:未绑定命令按「内置」置灰(提交语义,见 isShortcutRemappable 注释)", () => {
    sc.registerCommand({ id: "g.t", title: "T", run: () => undefined });
    expect(ov.isShortcutRemappable("g.t")).toBe(false);
  });
});

describe("validateOverride", () => {
  it("解绑(空串)直接 ok", () => {
    expect(ov.validateOverride("any", "")).toEqual({ ok: true });
  });
  it("无修饰键 → missing-modifier", () => {
    expect(ov.validateOverride("any", "K")).toEqual({ ok: false, reason: "missing-modifier" });
  });
  it("Escape 禁录", () => {
    expect(ov.validateOverride("any", "Cmd+Escape")).toEqual({
      ok: false,
      reason: "escape-forbidden",
    });
  });
  it("非法语法(双修饰键写法)→ syntax", () => {
    expect(ov.validateOverride("any", "Ctrl+Cmd+K")).toEqual({ ok: false, reason: "syntax" });
  });
  it("同作用域已绑 → conflict 并告知对方 id", () => {
    sc.registerCommand({ id: "a.x", title: "A", keybinding: "Cmd+B", run: () => undefined });
    sc.registerCommand({ id: "a.y", title: "Y", run: () => undefined });
    const r = ov.validateOverride("a.y", "Cmd+B");
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "conflict") {
      expect(r.detail).toBe("a.x");
    }
  });
  it("对方键位来自 override 也算占用(桩目检回归:effective 参与冲突)", () => {
    sc.registerCommand({ id: "a.x", title: "A", keybinding: "Cmd+B", run: () => undefined });
    sc.registerCommand({ id: "a.y", title: "Y", keybinding: "Cmd+W", run: () => undefined });
    ov.setShortcutOverrides({ "a.x": "Cmd+Shift+K" });
    const r = ov.validateOverride("a.y", "Cmd+Shift+K");
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "conflict") {
      expect(r.detail).toBe("a.x");
    }
  });
  it("对方 override 解绑后,其默认键位可被我占用", () => {
    sc.registerCommand({ id: "a.x", title: "A", keybinding: "Cmd+B", run: () => undefined });
    sc.registerCommand({ id: "a.y", title: "Y", run: () => undefined });
    ov.setShortcutOverrides({ "a.x": "" });
    expect(ov.validateOverride("a.y", "Cmd+B")).toEqual({ ok: true });
  });
  it("双方都有 when → 改写允许(同注册期规则)", () => {
    sc.registerCommand({
      id: "a.s",
      title: "A",
      keybinding: "Cmd+S",
      when: () => true,
      run: () => undefined,
    });
    sc.registerCommand({
      id: "b.s",
      title: "B",
      keybinding: "Cmd+S",
      when: () => true,
      run: () => undefined,
    });
    expect(ov.validateOverride("b.s", "Cmd+S")).toEqual({ ok: true });
  });
  it("跨作用域同键 → 改写允许(terminal.find 与 global 不冲突)", () => {
    sc.registerCommand({
      id: "t.f",
      title: "T",
      keybinding: "Cmd+F",
      scope: "terminal",
      run: () => undefined,
    });
    sc.registerCommand({ id: "g.f", title: "G", run: () => undefined });
    expect(ov.validateOverride("g.f", "Cmd+F")).toEqual({ ok: true });
  });
});

describe("isShortcutRecording 闸门", () => {
  it("默认 false,setShortcutRecording(true) → true", () => {
    expect(ov.isShortcutRecording()).toBe(false);
    ov.setShortcutRecording(true);
    expect(ov.isShortcutRecording()).toBe(true);
    ov.setShortcutRecording(false);
    expect(ov.isShortcutRecording()).toBe(false);
  });
});

describe("formatKeyEvent 录制期按键面转化", () => {
  it("Cmd+K → Cmd+K", () => {
    expect(ov.formatKeyEvent(keyEvent("k"))).toBe("Cmd+k");
  });
  it("Cmd+Shift+K → Cmd+Shift+K", () => {
    expect(ov.formatKeyEvent(keyEvent("k", { shiftKey: true }))).toBe("Cmd+Shift+k");
  });
  it("Alt+F4 保留", () => {
    expect(ov.formatKeyEvent(keyEvent("F4", { altKey: true, metaKey: false, ctrlKey: false }))).toBe("Alt+f4");
  });
  it("纯主键(无修饰) → 空串", () => {
    expect(ov.formatKeyEvent(keyEvent("k", { metaKey: false, ctrlKey: false }))).toBe("");
  });
  it("Space/Escape 命名键保留", () => {
    expect(ov.formatKeyEvent(keyEvent("Escape", { metaKey: false, ctrlKey: false, altKey: true }))).toBe("Alt+escape");
  });
  it("未知控制键 + 无修饰 → 空串", () => {
    expect(ov.formatKeyEvent(keyEvent("MediaPlayPause", { metaKey: false, ctrlKey: false }))).toBe("");
  });
});

describe("validateOverride 对 match 型区间", () => {
  it("改录进 ⌘1-9 区间 → 冲突(合成事件反演命中)", () => {
    sc.registerCommand({
      id: "g.tabs",
      title: "T",
      match: (e: ShortcutKeyEvent) => e.metaKey && /^[1-9]$/.test(e.key),
      run: () => undefined,
    });
    sc.registerCommand({ id: "g.t", title: "T", run: () => undefined });
    expect(ov.validateOverride("g.t", "Cmd+3")).toEqual({
      ok: false,
      reason: "conflict",
      detail: "g.tabs",
    });
  });
  it("区间外的键不受影响", () => {
    sc.registerCommand({
      id: "g.tabs",
      title: "T",
      match: (e: ShortcutKeyEvent) => e.metaKey && /^[1-9]$/.test(e.key),
      run: () => undefined,
    });
    sc.registerCommand({ id: "g.t", title: "T", run: () => undefined });
    expect(ov.validateOverride("g.t", "Cmd+0")).toEqual({ ok: true });
  });
});

describe("分发器消费 effective(override 即时生效)", () => {
  it("override 后:旧键穿透、新键命中", () => {
    sc.registerCommand({ id: "g.b", title: "B", keybinding: "Cmd+B", run: () => undefined });
    ov.setShortcutOverrides({ "g.b": "Cmd+Shift+K" });
    expect(sc.resolveCommand(keyEvent("b"))).toBeUndefined();
    expect(sc.resolveCommand(keyEvent("k", { shiftKey: true }))?.id).toBe("g.b");
  });

  it("解绑(空串)后:默认键穿透进 PTY", () => {
    sc.registerCommand({ id: "g.b", title: "B", keybinding: "Cmd+B", run: () => undefined });
    ov.setShortcutOverrides({ "g.b": "" });
    expect(sc.resolveCommand(keyEvent("b"))).toBeUndefined();
  });

  it("未绑定命令录键后:新键经分发命中", () => {
    sc.registerCommand({ id: "g.u", title: "U", run: () => undefined });
    ov.setShortcutOverrides({ "g.u": "Cmd+Shift+U" });
    expect(sc.resolveCommand(keyEvent("u", { shiftKey: true }))?.id).toBe("g.u");
  });

  it("录制闸开启:dispatcher 早返回,键不拦截、run 不触发", () => {
    let onKey: ((e: KeyboardEvent) => void) | undefined;
    vi.stubGlobal("window", {
      addEventListener: (_t: string, fn: (e: KeyboardEvent) => void) => {
        onKey = fn;
      },
      removeEventListener: () => undefined,
    });
    sc.installShortcutDispatcher();
    let ran = false;
    sc.registerCommand({ id: "g.b", title: "B", keybinding: "Cmd+B", run: () => (ran = true) });
    ov.setShortcutRecording(true);
    let prevented = false;
    onKey!({
      isComposing: false,
      key: "b",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: () => (prevented = true),
      stopPropagation: () => undefined,
    } as never);
    expect(ran).toBe(false);
    expect(prevented).toBe(false);
    ov.setShortcutRecording(false);
    vi.unstubAllGlobals();
  });
});

describe("formatKeyEvent 空格", () => {
  it("e.key === ' ' → space 命名键", () => {
    expect(ov.formatKeyEvent(keyEvent(" "))).toBe("Cmd+space");
  });
});
