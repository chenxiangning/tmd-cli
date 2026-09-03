/**
 * 会话置顶层行为契约测试(codemoss 双作用域置顶复刻)。
 * 覆盖:双作用域互斥迁移、toggle 语义(同 scope 取消 / 异 scope 迁移)、
 * unpin 幂等、listSessionPins 过滤与置顶时间升序。
 * settings 为模块级单例,每个用例经 vi.resetModules + 动态 import 取全新实例;
 * Date.now 经 vi.setSystemTime 钉死,置顶时间戳确定性错开。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  configReadSettings: vi.fn(),
  configWriteSettings: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

type PinsModule = typeof import("./sessionPins");
type SettingsModule = typeof import("./settings");

let pins: PinsModule;
let settings: SettingsModule;

beforeEach(async () => {
  vi.clearAllMocks();
  ipcMock.configReadSettings.mockResolvedValue(null);
  ipcMock.configWriteSettings.mockResolvedValue(undefined);
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  pins = await import("./sessionPins");
  settings = await import("./settings");
});

afterEach(() => {
  vi.useRealTimers();
});

const KEY_A = "ws1:claude:sess-a";
const KEY_B = "ws1:claude:sess-b";
const KEY_OTHER_WS = "ws2:claude:sess-a";
const KEY_OTHER_CLI = "ws1:codex:sess-a";

describe("key 构造与解析", () => {
  it("三段身份往返一致", () => {
    expect(pins.sessionPinKey("ws1", "claude", "sess-a")).toBe(KEY_A);
    expect(pins.parseSessionPinKey(KEY_A)).toEqual({
      workspaceId: "ws1",
      profileId: "claude",
      cliSessionId: "sess-a",
    });
  });

  it("非法结构返回 null(手改 JSON 兜底)", () => {
    expect(pins.parseSessionPinKey("")).toBeNull();
    expect(pins.parseSessionPinKey("ws1")).toBeNull();
    expect(pins.parseSessionPinKey("ws1:claude")).toBeNull();
    expect(pins.parseSessionPinKey(":claude:sess")).toBeNull();
    expect(pins.parseSessionPinKey("ws1:claude:")).toBeNull();
  });
});

describe("双作用域互斥", () => {
  it("pin 到另一作用域 = 迁移:旧 scope 消失,时间戳刷新", () => {
    expect(pins.pinSession(KEY_A, "workspace", "标题A")).toBe(true);
    const before = pins.getSessionPin(KEY_A);
    expect(before?.scope).toBe("workspace");

    vi.setSystemTime(2_000_000);
    expect(pins.pinSession(KEY_A, "global", "标题A")).toBe(true);
    const after = pins.getSessionPin(KEY_A);
    expect(after?.scope).toBe("global");
    expect(after!.pinnedAt).toBeGreaterThan(before!.pinnedAt);
  });

  it("相同 scope 重复 pin 为 no-op(返回 false,记录不变)", () => {
    pins.pinSession(KEY_A, "global", "标题A");
    const before = pins.getSessionPin(KEY_A);
    expect(pins.pinSession(KEY_A, "global", "新标题")).toBe(false);
    expect(pins.getSessionPin(KEY_A)).toEqual(before);
  });

  it("toggle:同 scope 取消,异 scope 迁移", () => {
    expect(pins.toggleSessionPin(KEY_A, "global", "标题A")).toBe(true);
    expect(pins.isSessionPinned(KEY_A, "global")).toBe(true);
    // 异 scope → 迁移
    expect(pins.toggleSessionPin(KEY_A, "workspace", "标题A")).toBe(true);
    expect(pins.isSessionPinned(KEY_A, "workspace")).toBe(true);
    expect(pins.isSessionPinned(KEY_A, "global")).toBe(false);
    // 同 scope → 取消
    expect(pins.toggleSessionPin(KEY_A, "workspace", "标题A")).toBe(false);
    expect(pins.isSessionPinned(KEY_A)).toBe(false);
  });

  it("unpin 幂等:未置顶为 no-op", () => {
    pins.unpinSession(KEY_A);
    expect(pins.isSessionPinned(KEY_A)).toBe(false);
    pins.pinSession(KEY_A, "global", "标题A");
    pins.unpinSession(KEY_A);
    expect(pins.isSessionPinned(KEY_A)).toBe(false);
  });
});

describe("listSessionPins 投影", () => {
  it("按 scope + 工作区 + CLI 过滤,置顶时间升序", () => {
    const all = () => settings.getSettingsState().settings.sessionPins;

    pins.pinSession(KEY_A, "workspace", "A");
    vi.setSystemTime(2_000_000);
    pins.pinSession(KEY_B, "workspace", "B");
    vi.setSystemTime(3_000_000);
    pins.pinSession(KEY_OTHER_WS, "workspace", "C");
    pins.pinSession(KEY_OTHER_CLI, "global", "D");

    const workspaceScope = pins.listSessionPins(all(), { scope: "workspace" });
    expect(workspaceScope.map((p) => p.key)).toEqual([KEY_A, KEY_B, KEY_OTHER_WS]);

    const ws1 = pins.listSessionPins(all(), {
      workspaceId: "ws1",
      scope: "workspace",
    });
    expect(ws1.map((p) => p.key)).toEqual([KEY_A, KEY_B]);
    expect(ws1[0].cliSessionId).toBe("sess-a");

    const ws1CodexGlobal = pins.listSessionPins(all(), {
      workspaceId: "ws1",
      profileId: "codex",
      scope: "global",
    });
    expect(ws1CodexGlobal.map((p) => p.key)).toEqual([KEY_OTHER_CLI]);
  });
});

describe("快照标题语义", () => {
  it("pinSession 缺省快照存空串:短码兜底不入库(历史缺陷曾把 shortId 存成快照)", () => {
    expect(pins.pinSession(KEY_A, "global")).toBe(true);
    expect(settings.getSettingsState().settings.sessionPins[KEY_A]?.title).toBe("");
  });

  it("refreshPinTitle 回填快照;未置顶 / 空标题 / 同值均 no-op", () => {
    const entryTitle = () =>
      settings.getSettingsState().settings.sessionPins[KEY_A]?.title;

    pins.refreshPinTitle(KEY_A, "未置顶时不写");
    expect(entryTitle()).toBeUndefined();

    pins.pinSession(KEY_A, "global");
    expect(entryTitle()).toBe("");
    pins.refreshPinTitle(KEY_A, "  ");
    expect(entryTitle()).toBe("");
    pins.refreshPinTitle(KEY_A, "Verify approval line features match client");
    expect(entryTitle()).toBe("Verify approval line features match client");
    pins.refreshPinTitle(KEY_A, "Verify approval line features match client");
    expect(entryTitle()).toBe("Verify approval line features match client");
  });
});
