/**
 * persist 拉盘合并的删除意图落盘测试(取消置顶重启复活回归,2026-09-13)。
 * 与 settings.test.ts 同桩:ipc.configRead/WriteSettings mock;模块级单例经
 * vi.resetModules + 动态 import 取全新实例。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

/** boot 时盘上文档 = disk。 */
async function bootWith(disk: unknown) {
  ipcMock.configReadSettings.mockResolvedValue(disk);
  settings.ensureSettingsBooted();
  await settings.settingsReady;
}

const pin = (at: number) => ({ scope: "global" as const, pinnedAt: at, title: "x" });

const lastWrite = () =>
  ipcMock.configWriteSettings.mock.calls.at(-1)![0] as Record<string, Record<string, unknown>>;

describe("persist 拉盘合并:删除意图落盘(取消置顶复活回归)", () => {
  it("boot 见过盘后删除 pin:写盘 payload 不含该 key(旧实现盘上并集复活)", async () => {
    await bootWith({ sessionPins: { A: pin(1000) } });
    settings.updateSettings({ sessionPins: {} });
    await vi.waitFor(() => expect(ipcMock.configWriteSettings).toHaveBeenCalled());
    expect(lastWrite().sessionPins).toEqual({});
  });

  it("他实例新增的 pin 照收;本地删除的 pin 落盘(并集防护与删除共存)", async () => {
    await bootWith({ sessionPins: { A: pin(1000) } });
    // 另一实例在盘上新增 B
    ipcMock.configReadSettings.mockResolvedValue({ sessionPins: { A: pin(1000), B: pin(1500) } });
    settings.updateSettings({ sessionPins: {} }); // 本地取消 A
    await vi.waitFor(() => expect(ipcMock.configWriteSettings).toHaveBeenCalled());
    expect(Object.keys(lastWrite().sessionPins)).toEqual(["B"]);
  });

  it("盘上条目已被他实例改动(重置顶新 ts):不判为本地删除,盘像保留", async () => {
    await bootWith({ sessionPins: { A: pin(1000) } });
    ipcMock.configReadSettings.mockResolvedValue({ sessionPins: { A: pin(2000) } });
    settings.updateSettings({ sessionPins: {} });
    await vi.waitFor(() => expect(ipcMock.configWriteSettings).toHaveBeenCalled());
    expect(lastWrite().sessionPins).toEqual({ A: pin(2000) });
  });

  it("无 ts 字段(sessionTitles):键序漂移也不误判为已改动,删除照常落盘", async () => {
    await bootWith({ sessionTitles: { t1: "标题一", t2: "标题二" } });
    // 他实例未动盘,仅 JSON 键序不同 → 仍判「本地删除」
    ipcMock.configReadSettings.mockResolvedValue({ sessionTitles: { t2: "标题二", t1: "标题一" } });
    settings.updateSettings({ sessionTitles: { t2: "标题二" } }); // 本地删 t1
    await vi.waitFor(() => expect(ipcMock.configWriteSettings).toHaveBeenCalled());
    expect(lastWrite().sessionTitles).toEqual({ t2: "标题二" });
  });

  it("他实例新增条目跨两次 persist 存活(review F1:吸收后二次写盘误删)", async () => {
    await bootWith({ sessionPins: { A: pin(1000) } });
    ipcMock.configReadSettings.mockResolvedValue({ sessionPins: { A: pin(1000), B: pin(1500) } });
    settings.updateSettings({ sessionPins: { A: pin(1000), C: pin(1600) } }); // 本实例置顶 C
    await vi.waitFor(() => expect(ipcMock.configWriteSettings).toHaveBeenCalledTimes(1));
    expect(Object.keys(lastWrite().sessionPins).sort()).toEqual(["A", "B", "C"]);
    // 第二次任意写盘:B 仍不在本实例内存 → 基线不含 B → 继续照收而非误删
    settings.updateSettings({ sessionPins: { A: pin(1000), C: pin(1600), D: pin(1700) } });
    await vi.waitFor(() => expect(ipcMock.configWriteSettings).toHaveBeenCalledTimes(2));
    expect(Object.keys(lastWrite().sessionPins).sort()).toEqual(["A", "B", "C", "D"]);
  });

  it("他实例改动后存活的条目二次写盘不被误删(基线保留旧戳)", async () => {
    await bootWith({ sessionPins: { A: pin(1000) } });
    ipcMock.configReadSettings.mockResolvedValue({ sessionPins: { A: pin(2000) } });
    settings.updateSettings({ sessionPins: {} }); // 本地删 A,但盘像已被他实例改动
    await vi.waitFor(() => expect(ipcMock.configWriteSettings).toHaveBeenCalledTimes(1));
    expect(lastWrite().sessionPins).toEqual({ A: pin(2000) });
    // 基线仍钉 A@1000(非吸收的 2000)→ 二次写盘盘像继续存活
    settings.updateSettings({ theme: "dark" });
    await vi.waitFor(() => expect(ipcMock.configWriteSettings).toHaveBeenCalledTimes(2));
    expect(lastWrite().sessionPins).toEqual({ A: pin(2000) });
  });
});
