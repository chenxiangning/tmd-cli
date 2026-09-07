/**
 * 会话归档层行为契约测试。
 * 覆盖:key 构造、归档/取消归档、幂等(unarchive 未见条目 no-op)、
 * 与置顶层互不干扰(各自独立 map)。
 * settings 为模块级单例,每个用例经 vi.resetModules + 动态 import 取全新实例;
 * Date.now 经 vi.setSystemTime 钉死,时间戳确定性。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  configReadSettings: vi.fn(),
  configWriteSettings: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

type ArchiveModule = typeof import("./sessionArchive");
type SettingsModule = typeof import("./settings");
type SanitizeModule = typeof import("./settingsSanitize");

let archive: ArchiveModule;
let settings: SettingsModule;
let sanitize: SanitizeModule;

beforeEach(async () => {
  vi.clearAllMocks();
  ipcMock.configReadSettings.mockResolvedValue(null);
  ipcMock.configWriteSettings.mockResolvedValue(undefined);
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  archive = await import("./sessionArchive");
  settings = await import("./settings");
  sanitize = await import("./settingsSanitize");
});

afterEach(() => {
  vi.useRealTimers();
});

const KEY_A = "ws1:claude:sess-a";

describe("sessionArchive", () => {
  it("key 三段身份构造,与置顶 key 同构", () => {
    expect(archive.sessionArchiveKey("ws1", "claude", "sess-a")).toBe(KEY_A);
  });

  it("归档 → isSessionArchived true + 记录时间戳;取消后 false", () => {
    expect(archive.isSessionArchived(KEY_A)).toBe(false);
    archive.archiveSession(KEY_A);
    expect(archive.isSessionArchived(KEY_A)).toBe(true);
    expect(settings.getSettingsState().settings.sessionArchive[KEY_A]).toEqual({
      archivedAt: 1_000_000,
    });
    archive.unarchiveSession(KEY_A);
    expect(archive.isSessionArchived(KEY_A)).toBe(false);
    expect(settings.getSettingsState().settings.sessionArchive[KEY_A]).toBeUndefined();
  });

  it("重复归档刷新时间戳;取消未见条目为 no-op", () => {
    archive.archiveSession(KEY_A);
    vi.setSystemTime(2_000_000);
    archive.archiveSession(KEY_A);
    expect(settings.getSettingsState().settings.sessionArchive[KEY_A]?.archivedAt).toBe(
      2_000_000,
    );
    archive.unarchiveSession("ws1:claude:missing");
    expect(Object.keys(settings.getSettingsState().settings.sessionArchive)).toEqual([KEY_A]);
  });

  it("容量满(200)逐出 archivedAt 最旧条目,新归档始终生效", () => {
    for (let i = 0; i < 200; i++) {
      vi.setSystemTime(1_000_000 + i);
      archive.archiveSession(`ws1:claude:old-${i}`);
    }
    const map = settings.getSettingsState().settings.sessionArchive;
    expect(Object.keys(map)).toHaveLength(200);
    vi.setSystemTime(3_000_000);
    archive.archiveSession(KEY_A);
    const after = settings.getSettingsState().settings.sessionArchive;
    expect(Object.keys(after)).toHaveLength(200);
    expect(after[KEY_A]).toEqual({ archivedAt: 3_000_000 });
    expect(after["ws1:claude:old-0"]).toBeUndefined();
    expect(after["ws1:claude:old-1"]).toBeDefined();
  });

  it("归档与置顶互不干扰(独立 map)", () => {
    archive.archiveSession(KEY_A);
    expect(settings.getSettingsState().settings.sessionPins).toEqual({});
  });
});

describe("settings 清洗", () => {
  it("sessionArchive:只收合法时间戳项,非法/缺失回落空 map", () => {
    const raw = {
      sessionArchive: {
        [KEY_A]: { archivedAt: 123 },
        bad1: { archivedAt: "x" },
        bad2: { archivedAt: -1 },
        bad3: "junk",
      },
    };
    expect(sanitize.sanitize(raw).sessionArchive).toEqual({
      [KEY_A]: { archivedAt: 123 },
    });
    expect(sanitize.sanitize(null).sessionArchive).toEqual({});
    expect(sanitize.sanitize({}).sessionArchive).toEqual({});
  });

  it("workspaceArchiveView:非 boolean 回落 false", () => {
    expect(sanitize.sanitize({ workspaceArchiveView: true }).workspaceArchiveView).toBe(true);
    expect(sanitize.sanitize({ workspaceArchiveView: "yes" }).workspaceArchiveView).toBe(false);
    expect(sanitize.sanitize({}).workspaceArchiveView).toBe(false);
  });
});
