/**
 * persist 补丁写与双实例丢更新防护测试(2026-09-11 归档失效回归 + 00d3dc5 竞态回归)。
 * 场景一:dev 版与打包版同时运行,共享 ~/.tmd-cli/settings.json;标记域(归档/
 * 置顶等)整域拉盘按 key 合并后再随补丁上送,陈旧实例不再抹掉另一实例新写的标记。
 * 场景二:写盘只上送被改域(00d3dc5)—— 整树覆盖写会把 Rust 直写盘回填的
 * webAccessEnabled 砸回内存旧值,中继绿灯但桥死;补丁写让未触碰的域不上线。
 * 契约:标记域合并只影响上送 payload,不改本实例内存态;标量以本实例为准。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  configReadSettings: vi.fn(),
  configMergeSettings: vi.fn(),
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
  ipcMock.configMergeSettings.mockResolvedValue(undefined);
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
  it("本实例写盘不抹掉另一实例新写的归档标记(未触碰域不上送)", async () => {
    // 本实例内存:归档表为空,只改了一个标量
    settings.updateSettings({ theme: "dark" });
    await vi.waitFor(() => expect(ipcMock.configMergeSettings).toHaveBeenCalled());
    ipcMock.configMergeSettings.mockClear();

    // 另一实例(打包版)此刻把 19 条归档 mark 写上了盘
    ipcMock.configReadSettings.mockResolvedValue(diskWithForeignMarks());

    // 本实例再次写任意设置(陈旧内存不知道盘上多了 19 条):
    // 补丁只送被改域,sessionArchive 根本不上线,盘上 19 条天然存活
    settings.updateSettings({ uiZoom: 1.1 });
    await vi.waitFor(() => expect(ipcMock.configMergeSettings).toHaveBeenCalled());

    const written = ipcMock.configMergeSettings.mock.lastCall![0] as Record<string, unknown>;
    expect("sessionArchive" in written).toBe(false);
    expect(written.uiZoom).toBe(1.1);
  });

  it("补丁写只上送被改域:陈旧 webAccessEnabled 不覆盖 Rust 直写盘(00d3dc5 回归)", async () => {
    // Rust web_relay_start 直写盘回填 webAccessEnabled=true;
    // settings:changed 广播的回读尚未回到本实例,内存还是 false
    ipcMock.configReadSettings.mockResolvedValue({ webAccessEnabled: true, theme: "light" });
    // 用户此刻改主题:整树写会把内存旧值 false 砸回盘(绿灯但桥死);补丁写只送 theme
    settings.updateSettings({ theme: "dark" });
    await vi.waitFor(() => expect(ipcMock.configMergeSettings).toHaveBeenCalled());

    const written = ipcMock.configMergeSettings.mock.lastCall![0] as Record<string, unknown>;
    expect(written.theme).toBe("dark");
    expect("webAccessEnabled" in written).toBe(false);
  });

  it("同 key 冲突取时间戳较新者(本实例陈旧时不回写旧戳)", async () => {
    settings.updateSettings({ theme: "dark" });
    await vi.waitFor(() => expect(ipcMock.configMergeSettings).toHaveBeenCalled());
    ipcMock.configMergeSettings.mockClear();

    // 盘上该 key 已被另一实例用更新的时间戳刷新;本实例内存还是旧戳
    ipcMock.configReadSettings.mockResolvedValue({
      sessionArchive: { "ws:omp:k1": { archivedAt: 2_000 } },
    });
    settings.updateSettings({
      sessionArchive: { "ws:omp:k1": { archivedAt: 1_000 } },
    });
    await vi.waitFor(() => expect(ipcMock.configMergeSettings).toHaveBeenCalled());

    const written = ipcMock.configMergeSettings.mock.lastCall![0] as Record<string, unknown>;
    expect(written.sessionArchive).toEqual({ "ws:omp:k1": { archivedAt: 2_000 } });
  });

  it("合并只影响写盘 payload,不串改本实例内存态", async () => {
    settings.updateSettings({ theme: "dark" });
    await vi.waitFor(() => expect(ipcMock.configMergeSettings).toHaveBeenCalled());
    ipcMock.configMergeSettings.mockClear();

    ipcMock.configReadSettings.mockResolvedValue(diskWithForeignMarks());
    settings.updateSettings({ uiZoom: 1.1 });
    await vi.waitFor(() => expect(ipcMock.configMergeSettings).toHaveBeenCalled());

    expect(Object.keys(settings.getSettingsState().settings.sessionArchive as object)).toHaveLength(0);
  });

  it("盘上读取失败时按本实例状态原样写(行为不变)", async () => {
    ipcMock.configReadSettings.mockRejectedValue(new Error("ipc down"));
    settings.updateSettings({ theme: "dark" });
    await vi.waitFor(() => expect(ipcMock.configMergeSettings).toHaveBeenCalled());
    const written = ipcMock.configMergeSettings.mock.lastCall![0] as Record<string, unknown>;
    expect(written.theme).toBe("dark");
  });
});
