/**
 * 界面缩放键位契约测试(zoomCommands):⌘+/⌘−/⌘0 三键的匹配面与写值链路。
 * 匹配面覆盖:mac「⌘⇧= → e.key='+'」两态、平台严格分流(mac 仅 meta、
 * win 仅 ctrl、unknown 双任一 —— 与 eventMatches 同口径,mac 的 Ctrl± 不劫持)、
 * alt 排除(⌥± 特殊字符输入)、裸键穿透(无修饰键不吃,防吞正常输入)。
 * mock @kernel/settings 断言 updateSettings 收到的目标档位(基准值取舍入后
 * 恰落目标档双数的 1 / 1.1:1+0.05 与 1.1−0.05 的最近双数均 === 字面量 1.05,
 * 断言不沾二进制尾差);越界钳位归 kernel sanitize,直传断言。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShortcutKeyEvent } from "@kernel/shortcuts";

const settingsMock = vi.hoisted(() => ({
  uiZoom: 1,
  UI_ZOOM_DEFAULT: 1,
  UI_ZOOM_STEP: 0.05,
  getSettingsState: () => ({ settings: { uiZoom: settingsMock.uiZoom } }),
  updateSettings: vi.fn(),
}));
vi.mock("@kernel/settings", () => settingsMock);

/* 平台可变 mock:mac 严格 meta / win 严格 ctrl / unknown 双任一(kernel/platform)。 */
const platformMock = vi.hoisted(() => ({ kind: "macos" as string }));
vi.mock("@kernel/platform", () => ({ getPlatformKind: () => platformMock.kind }));

type ShortcutsNs = typeof import("@kernel/shortcuts");
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
  settingsMock.uiZoom = 1;
  platformMock.kind = "macos";
  registry = await import("@kernel/shortcuts");
  await import("./zoomCommands");
});

describe("匹配面:平台严格分流(与 eventMatches 同口径)", () => {
  it("mac:⌘= / ⌘⇧= / ⌘− / ⌘0 都吃,Ctrl 系(emacs/终端生态)不劫持", () => {
    expect(cmd("shell.zoomIn").match?.(key("=", { metaKey: true }))).toBe(true);
    expect(cmd("shell.zoomIn").match?.(key("+", { metaKey: true, shiftKey: true }))).toBe(true);
    expect(cmd("shell.zoomOut").match?.(key("-", { metaKey: true }))).toBe(true);
    expect(cmd("shell.zoomReset").match?.(key("0", { metaKey: true }))).toBe(true);
    expect(cmd("shell.zoomIn").match?.(key("=", { ctrlKey: true }))).toBe(false);
    expect(cmd("shell.zoomOut").match?.(key("-", { ctrlKey: true }))).toBe(false);
    expect(cmd("shell.zoomReset").match?.(key("0", { ctrlKey: true }))).toBe(false);
  });

  it("win/linux:仅 ctrl;unknown:meta/ctrl 双任一兜底", async () => {
    platformMock.kind = "windows";
    expect(cmd("shell.zoomIn").match?.(key("=", { metaKey: true }))).toBe(false);
    expect(cmd("shell.zoomIn").match?.(key("=", { ctrlKey: true }))).toBe(true);
    platformMock.kind = "unknown";
    expect(cmd("shell.zoomOut").match?.(key("-", { metaKey: true }))).toBe(true);
    expect(cmd("shell.zoomOut").match?.(key("-", { ctrlKey: true }))).toBe(true);
  });
});

describe("匹配面:alt 排除与裸键穿透", () => {
  it("⌘⌥−(⌥ 系特殊字符输入)不吃", () => {
    expect(cmd("shell.zoomOut").match?.(key("-", { metaKey: true, altKey: true }))).toBe(false);
    expect(cmd("shell.zoomIn").match?.(key("=", { metaKey: true, altKey: true }))).toBe(false);
  });

  it("裸 = / 裸 − / 裸 0 不吃(防吞正常输入)", () => {
    expect(cmd("shell.zoomIn").match?.(key("="))).toBe(false);
    expect(cmd("shell.zoomOut").match?.(key("-"))).toBe(false);
    expect(cmd("shell.zoomReset").match?.(key("0"))).toBe(false);
  });
});

describe("写值链路", () => {
  it("放大/缩小按 UI_ZOOM_STEP 步进写 uiZoom", () => {
    settingsMock.uiZoom = 1;
    cmd("shell.zoomIn").run();
    expect(settingsMock.updateSettings).toHaveBeenCalledWith({ uiZoom: 1.05 });
    settingsMock.uiZoom = 1.1;
    cmd("shell.zoomOut").run();
    expect(settingsMock.updateSettings).toHaveBeenCalledWith({ uiZoom: 1.05 });
  });

  it("重置写 UI_ZOOM_DEFAULT;越界钳位归 kernel sanitize,此处直传", () => {
    settingsMock.uiZoom = 1.45;
    cmd("shell.zoomIn").run();
    expect(settingsMock.updateSettings).toHaveBeenCalledWith({ uiZoom: 1.5 });
    cmd("shell.zoomReset").run();
    expect(settingsMock.updateSettings).toHaveBeenCalledWith({ uiZoom: settingsMock.UI_ZOOM_DEFAULT });
  });
});
