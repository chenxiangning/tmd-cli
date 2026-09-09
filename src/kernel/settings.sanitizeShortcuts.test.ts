/**
 * shortcutOverrides 清洗契约测试 —— settings.shortcutOverrides 的 sanitize:
 * 非法 key/value 丢弃、超容量按 key 序截断、value 规范化(修饰键按 Cmd→Shift→Alt 顺序)。
 * 模块级单例,沿 settings.test 模板:vi.resetModules + 动态 import。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  configReadSettings: vi.fn(),
  configWriteSettings: vi.fn(),
}));
vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

type SanitizeModule = typeof import("./settingsSanitizeShortcuts");
let sanitize: SanitizeModule;

beforeEach(async () => {
  vi.clearAllMocks();
  ipcMock.configReadSettings.mockResolvedValue(null);
  ipcMock.configWriteSettings.mockResolvedValue(undefined);
  vi.resetModules();
  sanitize = await import("./settingsSanitizeShortcuts");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sanitizeShortcutOverrides", () => {
  it("非对象回落空表", () => {
    expect(sanitize.sanitizeShortcutOverrides(null)).toEqual({});
    expect(sanitize.sanitizeShortcutOverrides(undefined)).toEqual({});
    expect(sanitize.sanitizeShortcutOverrides("nope")).toEqual({});
    expect(sanitize.sanitizeShortcutOverrides([])).toEqual({});
  });

  it("合法键位串保留并规范化(主键小写)", () => {
    expect(
      sanitize.sanitizeShortcutOverrides({
        "shell.toggleLeftBar": "Cmd+Shift+L",
        "shell.openSettings": "Cmd+,",
      }),
    ).toEqual({
      "shell.toggleLeftBar": "Cmd+Shift+l",
      "shell.openSettings": "Cmd+,",
    });
  });

  it("非字符串 value 丢弃", () => {
    expect(
      sanitize.sanitizeShortcutOverrides({
        a: 1,
        b: true,
        c: "Cmd+K",
      }),
    ).toEqual({ c: "Cmd+k" });
  });

  it("非法 value 丢弃(裸键、未知名修饰符)", () => {
    expect(
      sanitize.sanitizeShortcutOverrides({
        a: "K",
        b: "Cmd+",
        c: "Meta+K",
      }),
    ).toEqual({});
  });

  it("空串(显式解绑)保留", () => {
    expect(sanitize.sanitizeShortcutOverrides({ a: "" })).toEqual({ a: "" });
  });

  it("value 规范化:乱序修饰键按 Cmd→Shift→Alt 顺序", () => {
    expect(sanitize.sanitizeShortcutOverrides({ a: "alt+shift+cmd+k" })).toEqual({
      a: "Cmd+Shift+Alt+k",
    });
  });

  it("超长 key 丢弃(>100 字符)", () => {
    const longKey = "a".repeat(101);
    expect(
      sanitize.sanitizeShortcutOverrides({ [longKey]: "Cmd+K", b: "Cmd+L" }),
    ).toEqual({ b: "Cmd+l" });
  });

  it("超容量按 key 升序截断(200 条)", () => {
    const raw: Record<string, string> = {};
    for (let i = 0; i < 250; i++) {
      raw[`a${i.toString().padStart(3, "0")}`] = "Cmd+K";
    }
    const out = sanitize.sanitizeShortcutOverrides(raw);
    expect(Object.keys(out).length).toBe(200);
    expect(Object.keys(out)[0]).toBe("a000");
    expect(Object.keys(out)[199]).toBe("a199");
  });
});

describe("normalizeKeybinding", () => {
  it("空串保留(显式解绑语义)", () => {
    expect(sanitize.normalizeKeybinding("")).toBe("");
  });
  it("无修饰键 → null", () => {
    expect(sanitize.normalizeKeybinding("K")).toBeNull();
  });
  it("Cmd+K → Cmd+k", () => {
    expect(sanitize.normalizeKeybinding("Cmd+K")).toBe("Cmd+k");
  });
  it("乱序:Alt+Shift+Cmd+K → Cmd+Shift+Alt+k", () => {
    expect(sanitize.normalizeKeybinding("Alt+Shift+Cmd+K")).toBe("Cmd+Shift+Alt+k");
  });
  it("非法 token → null", () => {
    expect(sanitize.normalizeKeybinding("Meta+K")).toBeNull();
  });
});
