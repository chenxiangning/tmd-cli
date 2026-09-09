/**
 * workspaceGroups / workspaceGroupCollapsedMap sanitize 行为测试。
 * 从 settings.test.ts 拆出(文件规模铁则);同一单例 harness 惯例。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  configReadSettings: vi.fn(),
  configWriteSettings: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

type SettingsModule = typeof import("./settings");

let settings: SettingsModule;

beforeEach(async () => {
  vi.clearAllMocks();
  ipcMock.configReadSettings.mockResolvedValue(null);
  ipcMock.configWriteSettings.mockResolvedValue(undefined);
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  settings = await import("./settings");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workspaceGroups sanitize", () => {
  it("脏项剔除、name trim、按 id 去重(保序)", () => {
    settings.updateSettings({
      workspaceGroups: [
        { id: "g1", name: "  前端  " },
        { id: "", name: "空id" },
        { id: "g1", name: "重复id" },
        { id: "g2", name: "   " },
        { name: "缺id" },
        "junk",
        null,
        { id: "g2", name: "后端" },
      ] as never,
    });
    expect(settings.getSettingsState().settings.workspaceGroups).toEqual([
      { id: "g1", name: "前端" },
      { id: "g2", name: "后端" },
    ]);
  });

  it("非数组回落空表(失败安全方向)", () => {
    settings.updateSettings({ workspaceGroups: "g1" as never });
    expect(settings.getSettingsState().settings.workspaceGroups).toEqual([]);
  });
});

describe("workspaceGroupCollapsedMap sanitize", () => {
  it("只收 boolean 值,非 boolean 剔除", () => {
    settings.updateSettings({
      workspaceGroupCollapsedMap: { g1: true, g2: "yes", g3: false },
    } as never);
    expect(settings.getSettingsState().settings.workspaceGroupCollapsedMap).toEqual({
      g1: true,
      g3: false,
    });
  });
});
