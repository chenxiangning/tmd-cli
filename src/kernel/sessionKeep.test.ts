/**
 * 会话保留层契约(清扫跳过的手动意图标记)。
 * 覆盖:mark/has/unmark 幂等语义 + 与归档层互不干扰 + 清洗白名单。
 * settings 为模块级单例,经 vi.resetModules + 动态 import 取全新实例(同 sessionArchive.test)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  configReadSettings: vi.fn(),
  configMergeSettings: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

type KeepModule = typeof import("./sessionKeep");
type ArchiveModule = typeof import("./sessionArchive");
type SettingsModule = typeof import("./settings");
type SanitizeModule = typeof import("./settingsSanitize");

let keep: KeepModule;
let archive: ArchiveModule;
let settings: SettingsModule;
let sanitize: SanitizeModule;

beforeEach(async () => {
  vi.clearAllMocks();
  ipcMock.configReadSettings.mockResolvedValue(null);
  ipcMock.configMergeSettings.mockResolvedValue(undefined);
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  keep = await import("./sessionKeep");
  archive = await import("./sessionArchive");
  settings = await import("./settings");
  sanitize = await import("./settingsSanitize");
});

const KEY_A = "ws1:claude:sess-a";

describe("sessionKeep", () => {
  it("key 三段身份构造,与归档 key 同构", () => {
    expect(keep.sessionKeepKey("ws1", "claude", "sess-a")).toBe(KEY_A);
  });

  it("标记 → isSessionKept true + 时间戳;取消后 false;未见条目 unmark no-op", () => {
    expect(keep.isSessionKept(KEY_A)).toBe(false);
    keep.keepSession(KEY_A);
    expect(keep.isSessionKept(KEY_A)).toBe(true);
    expect(settings.getSettingsState().settings.sessionKeep[KEY_A]).toEqual({
      keptAt: 1_000_000,
    });
    keep.unkeepSession("ws1:claude:missing");
    keep.unkeepSession(KEY_A);
    expect(keep.isSessionKept(KEY_A)).toBe(false);
  });

  it("与归档层互不干扰(各自独立 map)", () => {
    keep.keepSession(KEY_A);
    expect(archive.isSessionArchived(KEY_A)).toBe(false);
    archive.archiveSession(KEY_A);
    expect(keep.isSessionKept(KEY_A)).toBe(true);
  });
});

describe("settings 清洗", () => {
  it("sessionKeep:只收合法时间戳项,非法/缺失回落空 map", () => {
    const raw = {
      sessionKeep: {
        [KEY_A]: { keptAt: 123 },
        bad1: { keptAt: "x" },
        bad2: { keptAt: -1 },
        bad3: "junk",
      },
    };
    expect(sanitize.sanitize(raw).sessionKeep).toEqual({ [KEY_A]: { keptAt: 123 } });
    expect(sanitize.sanitize(null).sessionKeep).toEqual({});
  });

  it("sessionHygieneHours:白名单值通过,非白名单回落 24", () => {
    for (const h of [12, 24, 48, 168]) {
      expect(sanitize.sanitize({ sessionHygieneHours: h }).sessionHygieneHours).toBe(h);
    }
    expect(sanitize.sanitize({ sessionHygieneHours: 6 }).sessionHygieneHours).toBe(24);
    expect(sanitize.sanitize({ sessionHygieneHours: "24" }).sessionHygieneHours).toBe(24);
    expect(sanitize.sanitize({}).sessionHygieneHours).toBe(24);
  });

  it("sessionHygieneEnabled:非 boolean 回落 true(默认开)", () => {
    expect(sanitize.sanitize({ sessionHygieneEnabled: false }).sessionHygieneEnabled).toBe(false);
    expect(sanitize.sanitize({ sessionHygieneEnabled: "no" }).sessionHygieneEnabled).toBe(true);
    expect(sanitize.sanitize({}).sessionHygieneEnabled).toBe(true);
  });
});
