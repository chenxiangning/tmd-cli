/**
 * persist 双实例丢更新防护测试(2026-09-11 归档失效回归)。
 * 场景:dev 版与打包版同时运行,共享 ~/.tmd-cli/settings.json;persist 是
 * 全文件覆盖写,陈旧实例一次写盘即抹掉另一实例新写的归档/置顶等标记
 * (实证:200 条归档 mark 被打包版 15:02 的陈旧内存覆盖)。
 * 契约:persist 前拉盘上最新,记录型字段按 key 合并;标量以本实例为准;
 * 合并只影响写盘 payload,不改本实例内存态(另一实例的标记不实时串窗)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  configReadSettings: vi.fn(),
  configWriteSettings: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

/** 被测模块是模块级单例,须经 resetModules + 动态 import 取全新实例(同 sessionArchive.test.ts)。 */
interface SettingsModule {
  ensureSettingsBooted: () => void;
  settingsReady: Promise<void>;
  updateSettings: (patch: Record<string, unknown>) => void;
  getSettingsState: () => { settings: Record<string, unknown> };
}

let settings: SettingsModule;

beforeEach(async () => {
  vi.clearAllMocks();
  ipcMock.configReadSettings.mockResolvedValue(null);
  ipcMock.configWriteSettings.mockResolvedValue(undefined);
  vi.resetModules();
  settings = (await import("./settings")) as unknown as SettingsModule;
  settings.ensureSettingsBooted();
  await settings.settingsReady;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 另一实例写盘后的磁盘形状:A 归档了 19 条(带时间戳),标量还是旧值。 */
const diskWithForeignMarks = () => {
  const marks: Record<string, { archivedAt: number }> = {};
  for (let i = 0; i < 19; i++) {
    marks[`ws:omp:01a0730${i}-0000-0000-0000-000000000000`] = { archivedAt: 1_778_000_000_000 + i };
  }
  return { sessionArchive: marks, theme: "light" };
};

describe("persist 双实例合并", () => {
  it("本实例写盘不抹掉另一实例新写的归档标记", async () => {
    // 本实例内存:归档表为空,只改了一个标量
    settings.updateSettings({ theme: "dark" });
    await vi.waitFor(() => expect(ipcMock.configWriteSettings).toHaveBeenCalled());
    ipcMock.configWriteSettings.mockClear();

    // 另一实例(打包版)此刻把 19 条归档 mark 写上了盘
    ipcMock.configReadSettings.mockResolvedValue(diskWithForeignMarks());

    // 本实例再次写任意设置(陈旧内存不知道盘上多了 19 条)
    settings.updateSettings({ uiZoom: 1.1 });
    await vi.waitFor(() => expect(ipcMock.configWriteSettings).toHaveBeenCalled());

    const written = ipcMock.configWriteSettings.mock.lastCall![0] as Record<string, unknown>;
    expect(Object.keys(written.sessionArchive as object)).toHaveLength(19);
    expect(written.uiZoom).toBe(1.1);
  });

  it("同 key 冲突取时间戳较新者(本实例陈旧时不回写旧戳)", async () => {
    settings.updateSettings({ theme: "dark" });
    await vi.waitFor(() => expect(ipcMock.configWriteSettings).toHaveBeenCalled());
    ipcMock.configWriteSettings.mockClear();

    // 盘上该 key 已被另一实例用更新的时间戳刷新;本实例内存还是旧戳
    ipcMock.configReadSettings.mockResolvedValue({
      sessionArchive: { "ws:omp:k1": { archivedAt: 2_000 } },
    });
    settings.updateSettings({
      sessionArchive: { "ws:omp:k1": { archivedAt: 1_000 } },
    });
    await vi.waitFor(() => expect(ipcMock.configWriteSettings).toHaveBeenCalled());

    const written = ipcMock.configWriteSettings.mock.lastCall![0] as Record<string, unknown>;
    expect(written.sessionArchive).toEqual({ "ws:omp:k1": { archivedAt: 2_000 } });
  });

  it("合并只影响写盘 payload,不串改本实例内存态", async () => {
    settings.updateSettings({ theme: "dark" });
    await vi.waitFor(() => expect(ipcMock.configWriteSettings).toHaveBeenCalled());
    ipcMock.configWriteSettings.mockClear();

    ipcMock.configReadSettings.mockResolvedValue(diskWithForeignMarks());
    settings.updateSettings({ uiZoom: 1.1 });
    await vi.waitFor(() => expect(ipcMock.configWriteSettings).toHaveBeenCalled());

    expect(Object.keys(settings.getSettingsState().settings.sessionArchive as object)).toHaveLength(0);
  });

  it("盘上读取失败时按本实例状态原样写(行为不变)", async () => {
    ipcMock.configReadSettings.mockRejectedValue(new Error("ipc down"));
    settings.updateSettings({ theme: "dark" });
    await vi.waitFor(() => expect(ipcMock.configWriteSettings).toHaveBeenCalled());
    const written = ipcMock.configWriteSettings.mock.lastCall![0] as Record<string, unknown>;
    expect(written.theme).toBe("dark");
  });
});
