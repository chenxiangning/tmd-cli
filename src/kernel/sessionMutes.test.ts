/**
 * 会话静音层契约(通知会话级静音/暂停)。
 * 覆盖:三档 × 四类别判定矩阵(mutedKinds)、muteSession/unmuteSession/clearSnooze
 * (snooze 自清不误撤手动档)、tmd 会话 id → 三段 key 身份判空、清洗白名单
 * (档位枚举/mutedAt/askRing/2000 帽)与 settings 缺字段兼容。
 * settings 为模块级单例,经 vi.resetModules + 动态 import 取全新实例(同 sessionKeep.test)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  configReadSettings: vi.fn(),
  configMergeSettings: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

type MutesModule = typeof import("./sessionMutes");
type SanitizeModule = typeof import("./settingsSanitize");
type SanitizeSessionsModule = typeof import("./settingsSanitizeSessions");

let mutes: MutesModule;
let sanitize: SanitizeModule;
let sessions: SanitizeSessionsModule;

beforeEach(async () => {
  vi.clearAllMocks();
  ipcMock.configReadSettings.mockResolvedValue(null);
  ipcMock.configMergeSettings.mockResolvedValue(undefined);
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  mutes = await import("./sessionMutes");
  sanitize = await import("./settingsSanitize");
  sessions = await import("./settingsSanitizeSessions");
});

const KEY = "ws1:claude:sess-a";

describe("mutedKinds(三档 × 四类别矩阵)", () => {
  const entry = (mode: "mute" | "full" | "snooze", askRing?: boolean) =>
    ({ mutedAt: 1, mode, ...(askRing === undefined ? {} : { askRing }) });

  it("mute:静 turnEnd/exit/quota,ask 穿透", () => {
    expect(mutes.mutedKinds(entry("mute"), "turnEnd")).toBe(true);
    expect(mutes.mutedKinds(entry("mute"), "exit")).toBe(true);
    expect(mutes.mutedKinds(entry("mute"), "quota")).toBe(true);
    expect(mutes.mutedKinds(entry("mute"), "ask")).toBe(false);
  });

  it("full:全静;askRing=true 时 ask 穿透(其余照静)", () => {
    expect(mutes.mutedKinds(entry("full"), "ask")).toBe(true);
    expect(mutes.mutedKinds(entry("full"), "turnEnd")).toBe(true);
    expect(mutes.mutedKinds(entry("full"), "exit")).toBe(true);
    expect(mutes.mutedKinds(entry("full"), "quota")).toBe(true);
    expect(mutes.mutedKinds(entry("full", true), "ask")).toBe(false);
    expect(mutes.mutedKinds(entry("full", true), "turnEnd")).toBe(true);
  });

  it("snooze:静 turnEnd/quota,ask 与 exit 穿透(exit 穿透防 entry 等不到自清)", () => {
    expect(mutes.mutedKinds(entry("snooze"), "turnEnd")).toBe(true);
    expect(mutes.mutedKinds(entry("snooze"), "quota")).toBe(true);
    expect(mutes.mutedKinds(entry("snooze"), "ask")).toBe(false);
    expect(mutes.mutedKinds(entry("snooze"), "exit")).toBe(false);
  });

  it("未静音(undefined)一切放行", () => {
    for (const kind of ["ask", "turnEnd", "exit", "quota"] as const) {
      expect(mutes.mutedKinds(undefined, kind)).toBe(false);
    }
  });
});

describe("领域 API(写链走 settings)", () => {
  it("muteSession 写档位 + 时间戳;重复调用换档刷新", () => {
    mutes.muteSession(KEY, "snooze");
    expect(mutes.getSessionMute(KEY)).toEqual({ mutedAt: 1_000_000, mode: "snooze" });
    mutes.muteSession(KEY, "full", true);
    expect(mutes.getSessionMute(KEY)).toEqual({ mutedAt: 1_000_000, mode: "full", askRing: true });
  });

  it("unmuteSession 取消;未静音 no-op", () => {
    mutes.unmuteSession(KEY); /* 不存在:不写盘 */
    expect(ipcMock.configMergeSettings).not.toHaveBeenCalled();
    mutes.muteSession(KEY, "mute");
    mutes.unmuteSession(KEY);
    expect(mutes.getSessionMute(KEY)).toBeUndefined();
  });

  it("clearSnooze 只清 snooze 档;mute/full 手动档不被事件误撤;未静音 no-op", () => {
    mutes.muteSession(KEY, "snooze");
    mutes.clearSnooze(KEY);
    expect(mutes.getSessionMute(KEY)).toBeUndefined();

    mutes.muteSession(KEY, "full");
    mutes.clearSnooze(KEY);
    expect(mutes.getSessionMute(KEY)?.mode).toBe("full");

    mutes.clearSnooze("ws1:claude:none");
    expect(mutes.getSessionMute("ws1:claude:none")).toBeUndefined();
  });
});

describe("key 构造与身份判空", () => {
  const LOOKUP = {
    getSessions: () => [
      { id: "tmd1", workspaceId: "ws1", profileId: "claude" },
      { id: "tmd2", profileId: "claude" }, /* 无 workspaceId */
    ],
    getCliSessionId: (id: string) => (id === "tmd1" ? "sess-a" : undefined),
  };

  it("muteKeyOf:三段身份成 key,cliSessionId 缺失(未落盘)= undefined", () => {
    expect(mutes.muteKeyOf("ws1", "claude", "sess-a")).toBe(KEY);
    expect(mutes.muteKeyOf("ws1", "claude", undefined)).toBeUndefined();
  });

  it("tmdSessionMuteKey:活会话 id → key;未落盘/无工作区 = undefined", () => {
    expect(mutes.tmdSessionMuteKey("tmd1", LOOKUP)).toBe(KEY);
    expect(mutes.tmdSessionMuteKey("tmd2", LOOKUP)).toBeUndefined();
    expect(mutes.tmdSessionMuteKey("ghost", LOOKUP)).toBeUndefined();
  });
});

describe("清洗", () => {
  it("非法输入回落空对象;数组也回落", () => {
    for (const bad of [null, "x", [], [{}]]) {
      expect(sessions.sanitizeSessionMutes(bad)).toEqual({});
    }
  });

  it("合法项透传(mutedAt 取整);档位白名单外/负数/非有限丢弃;askRing 仅留 true", () => {
    const out = sessions.sanitizeSessionMutes({
      ok: { mutedAt: 100.7, mode: "full", askRing: true },
      ok2: { mutedAt: 0, mode: "mute", askRing: "yes" },
      badMode: { mutedAt: 1, mode: "soft" },
      badTs: { mutedAt: -1, mode: "mute" },
      nanTs: { mutedAt: Number.NaN, mode: "snooze" },
      junk: "x",
    });
    expect(out).toEqual({
      ok: { mutedAt: 100, mode: "full", askRing: true },
      ok2: { mutedAt: 0, mode: "mute" },
    });
  });

  it("2000 条按 key 序限量(上限与 SESSION_MUTES_MAX 同源),超限丢弃", () => {
    const raw: Record<string, unknown> = {};
    for (let i = 0; i < mutes.SESSION_MUTES_MAX + 10; i++) raw[`k${String(i).padStart(5, "0")}`] = { mutedAt: i, mode: "mute" };
    const out = sessions.sanitizeSessionMutes(raw);
    expect(Object.keys(out)).toHaveLength(mutes.SESSION_MUTES_MAX);
    expect(out[`k${String(mutes.SESSION_MUTES_MAX - 1).padStart(5, "0")}`]).toEqual({
      mutedAt: mutes.SESSION_MUTES_MAX - 1,
      mode: "mute",
    });
  });

  it("settings 缺字段兼容:sanitize({}) 补空 map;磁盘旧档无 sessionMutes 不炸", () => {
    expect(sanitize.sanitize({}).sessionMutes).toEqual({});
    const full = sanitize.sanitize({ sessionMutes: { [KEY]: { mutedAt: 5, mode: "snooze" } } });
    expect(full.sessionMutes).toEqual({ [KEY]: { mutedAt: 5, mode: "snooze" } });
  });
});
