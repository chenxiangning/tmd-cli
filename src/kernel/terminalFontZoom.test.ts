/**
 * 终端字号缩放键位契约(terminalFontZoom,042 随手带):⌘+/⌘−/⌘0 三键的
 * 匹配面与写值链路。匹配面与 app-shell/zoomCommands.test 同口径复用:
 * mac「⌘⇧= → e.key='+'」两态、平台严格分流(mac 仅 meta、win 仅 ctrl、
 * unknown 双任一;mac 的 Ctrl± 不劫持)、alt 排除、裸键穿透、shift 态区分
 * (⌘⇧− 不吃,防误缩)。写值链路:terminalFontSize ±1 / 回落默认 13,
 * ±1 写入前在本模块按 MIN/MAX 夹取(settings sanitize 是越界回落默认非钳位)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShortcutKeyEvent } from "@kernel/shortcuts";

const settingsMock = vi.hoisted(() => ({
  terminalFontSize: 13,
  TERMINAL_FONT_SIZE_DEFAULT: 13,
  TERMINAL_FONT_SIZE_MIN: 10,
  TERMINAL_FONT_SIZE_MAX: 20,
  getSettingsState: () => ({ settings: { terminalFontSize: settingsMock.terminalFontSize } }),
  updateSettings: vi.fn(),
}));
vi.mock("@kernel/settings", () => settingsMock);
vi.mock("@kernel/i18n", () => ({ t: (k: string) => k }));

/* 平台可变 mock:mac 严格 meta / win 严格 ctrl / unknown 双任一(kernel/platform)。 */
const platformMock = vi.hoisted(() => ({ kind: "macos" as string }));
vi.mock("@kernel/platform", () => ({ getPlatformKind: () => platformMock.kind }));

type ShortcutsNs = typeof import("@kernel/shortcuts"); /* 动态导入系 vi.resetModules 注册表隔离所需(zoomCommands.test 同款例外) */
let registry: ShortcutsNs;

function key(key: string, extra?: Partial<ShortcutKeyEvent>): ShortcutKeyEvent {
  return { key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...extra };
}

function cmd(id: string) {
  const c = registry.getCommands().find((x) => x.id === id);
  if (!c) throw new Error(`命令未注册: ${id}`);
  return c;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  settingsMock.terminalFontSize = 13;
  platformMock.kind = "macos";
  registry = await import("@kernel/shortcuts");
  await import("./terminalFontZoom");
});

describe("匹配面:平台严格分流(与 eventMatches 同口径)", () => {
  it("mac:⌘= / ⌘⇧= / ⌘− / ⌘0 都吃,Ctrl 系(emacs/终端生态)不劫持", () => {
    expect(cmd("terminal.zoomIn").match?.(key("=", { metaKey: true }))).toBe(true);
    expect(cmd("terminal.zoomIn").match?.(key("+", { metaKey: true, shiftKey: true }))).toBe(true);
    expect(cmd("terminal.zoomOut").match?.(key("-", { metaKey: true }))).toBe(true);
    expect(cmd("terminal.zoomReset").match?.(key("0", { metaKey: true }))).toBe(true);
    expect(cmd("terminal.zoomIn").match?.(key("=", { ctrlKey: true }))).toBe(false);
    expect(cmd("terminal.zoomOut").match?.(key("-", { ctrlKey: true }))).toBe(false);
    expect(cmd("terminal.zoomReset").match?.(key("0", { ctrlKey: true }))).toBe(false);
  });

  it("win 严格 Ctrl 系;unknown 双任一兜底", () => {
    platformMock.kind = "windows";
    expect(cmd("terminal.zoomIn").match?.(key("=", { metaKey: true }))).toBe(false);
    expect(cmd("terminal.zoomIn").match?.(key("=", { ctrlKey: true }))).toBe(true);
    platformMock.kind = "unknown";
    expect(cmd("terminal.zoomOut").match?.(key("-", { metaKey: true }))).toBe(true);
    expect(cmd("terminal.zoomOut").match?.(key("-", { ctrlKey: true }))).toBe(true);
  });

  it("alt 排除(⌥± 特殊字符输入);⌘⇧− 不吃(与 ⌘+ 的 ⇧= 形态区分)", () => {
    expect(cmd("terminal.zoomOut").match?.(key("-", { metaKey: true, altKey: true }))).toBe(false);
    expect(cmd("terminal.zoomIn").match?.(key("=", { metaKey: true, altKey: true }))).toBe(false);
    expect(cmd("terminal.zoomOut").match?.(key("-", { metaKey: true, shiftKey: true }))).toBe(false);
    expect(cmd("terminal.zoomReset").match?.(key("0", { metaKey: true, shiftKey: true }))).toBe(false);
  });

  it("裸 = / 裸 − / 裸 0 不吃(防吞正常输入)", () => {
    expect(cmd("terminal.zoomIn").match?.(key("="))).toBe(false);
    expect(cmd("terminal.zoomOut").match?.(key("-"))).toBe(false);
    expect(cmd("terminal.zoomReset").match?.(key("0"))).toBe(false);
  });

  it("作用域 terminal:聚焦期优先,未命中键穿透(global shell.zoom 兜底)", () => {
    expect(cmd("terminal.zoomIn").scope).toBe("terminal");
  });
});

describe("写值链路", () => {
  it("±1 步进写 terminalFontSize;⌘0 回落默认 13", () => {
    cmd("terminal.zoomIn").run();
    expect(settingsMock.updateSettings).toHaveBeenCalledWith({ terminalFontSize: 14 });
    settingsMock.terminalFontSize = 13;
    cmd("terminal.zoomOut").run();
    expect(settingsMock.updateSettings).toHaveBeenCalledWith({ terminalFontSize: 12 });
    settingsMock.terminalFontSize = 17;
    cmd("terminal.zoomReset").run();
    expect(settingsMock.updateSettings).toHaveBeenCalledWith({ terminalFontSize: 13 });
  });

  it("边界夹取:20 时 ⌘+ 不再 +1(不回落默认),10 时 ⌘− 不再 −1", () => {
    settingsMock.terminalFontSize = 20;
    cmd("terminal.zoomIn").run();
    expect(settingsMock.updateSettings).toHaveBeenCalledWith({ terminalFontSize: 20 });
    settingsMock.terminalFontSize = 10;
    cmd("terminal.zoomOut").run();
    expect(settingsMock.updateSettings).toHaveBeenCalledWith({ terminalFontSize: 10 });
  });
});
