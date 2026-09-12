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

describe("满表回归(2026-09-11 用户实盘:200 条后批量归档静默无效)", () => {
  /** 仿用户实盘种子:id 区间、archivedAt 窗口(95 秒内 200 条)取真实数据形状。 */
  const seedFullTable = () => {
    const table: Record<string, { archivedAt: number }> = {};
    for (let i = 0; i < 200; i++) {
      const id = `01a0${(0x5b32 + i * 0x17).toString(16).padStart(4, "0")}-0000-0000-0000-000000000000`;
      table[`ws-mtiwe7vz:omp:${id}`] = { archivedAt: 1_778_000_000_000 + i * 400 };
    }
    return table;
  };

  it("表满 200 时再归档新会话仍生效(换出最旧)", () => {
    settings.updateSettings({ sessionArchive: seedFullTable() });
    const missing = "ws-mtiwe7vz:omp:01a07308-3115-711f-a57e-85f58e0600eb";
    archive.archiveSession(missing);
    expect(archive.isSessionArchived(missing)).toBe(true);
  });

  it("表满 200 时批量归档 19 条全部生效(时钟递增,换出 19 条最旧)", () => {
    settings.updateSettings({ sessionArchive: seedFullTable() });
    const batch = Array.from(
      { length: 19 },
      (_, i) => `ws-mtiwe7vz:omp:01a07${(0x300 + i).toString(16)}-1111-1111-1111-111111111111`,
    );
    /* 时钟随 mark 递增,且拨到真实纪元刻度(晚于种子 ts):新 mark 时间戳
     * 恒新于表内,逐出只命中旧条目 —— 与真实墙钟形态一致。 */
    batch.forEach((k, i) => {
      vi.setSystemTime(1_778_100_000_000 + i);
      archive.archiveSession(k);
    });
    for (const k of batch) expect(archive.isSessionArchived(k)).toBe(true);
    expect(Object.keys(settings.getSettingsState().settings.sessionArchive)).toHaveLength(200);
  });

  it("时钟停滞(同毫秒批量)时后 mark 换出先 mark:新条目至少保留最后一条且总数守恒", () => {
    settings.updateSettings({ sessionArchive: seedFullTable() });
    const batch = Array.from(
      { length: 19 },
      (_, i) => `ws-mtiwe7vz:omp:01a07${(0x300 + i).toString(16)}-2222-2222-2222-222222222222`,
    );
    batch.forEach((k) => archive.archiveSession(k));
    expect(Object.keys(settings.getSettingsState().settings.sessionArchive)).toHaveLength(200);
    expect(archive.isSessionArchived(batch[18])).toBe(true);
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
