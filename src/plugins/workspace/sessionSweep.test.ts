/**
 * 会话卫生清扫门控契约(超期自动归档 + 空会话删除)。
 * 只锁清扫自己的决策面:候选筛选五道门(时间未知/未超期/活会话/已归档已删/保留置顶)、
 * 批量归档单次写、远程分支不删盘、空判定后才删。覆盖层与删除语义归各自模块测。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
const mocks = vi.hoisted(() => ({
  archiveSessions: vi.fn(),
  isSessionArchived: vi.fn((_k: string) => false),
  isSessionDeleted: vi.fn((_k: string) => false),
  isSessionKept: vi.fn((_k: string) => false),
  deleteDiskSessionFull: vi.fn(async () => undefined),
  settings: {
    sessionHygieneEnabled: true,
    sessionHygieneHours: 24,
    sessionPins: {} as Record<string, unknown>,
  },
}));

vi.mock("@kernel/settings", () => ({
  getSettingsState: () => ({ settings: mocks.settings }),
}));
vi.mock("@kernel/sessionArchive", () => ({
  archiveSessions: mocks.archiveSessions,
  isSessionArchived: mocks.isSessionArchived,
  sessionArchiveKey: (w: string, p: string, c: string) => `${w}:${p}:${c}`,
}));
vi.mock("@kernel/sessionDeleted", () => ({
  isSessionDeleted: mocks.isSessionDeleted,
  sessionDeletedKey: (w: string, p: string, c: string) => `${w}:${p}:${c}`,
}));
vi.mock("@kernel/sessionKeep", () => ({
  isSessionKept: mocks.isSessionKept,
  sessionKeepKey: (w: string, p: string, c: string) => `${w}:${p}:${c}`,
}));
vi.mock("./sessionOps", () => ({
  deleteDiskSessionFull: mocks.deleteDiskSessionFull,
}));

import { sweepStaleSessions } from "./sessionSweep";

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

const ws = { id: "ws1", root: "/repo" } as never;

function entry(id: string, ageHours: number): CliDiskSession {
  return { id, path: `/repo/.x/${id}.jsonl`, modifiedAt: NOW - ageHours * HOUR };
}

function profile(isEmpty: boolean | null = null): CliProfile {
  return {
    id: "omp",
    isDiskSessionEmpty:
      isEmpty === null
        ? undefined
        : vi.fn(async () => isEmpty),
  } as unknown as CliProfile;
}

async function sweep(
  sessions: CliDiskSession[],
  opts: { liveCliIds?: Set<string>; allowDelete?: boolean; profile?: CliProfile } = {},
) {
  return sweepStaleSessions({
    profile: opts.profile ?? profile(),
    workspace: ws,
    sessions,
    liveCliIds: opts.liveCliIds ?? new Set(),
    allowDelete: opts.allowDelete ?? true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.settings.sessionHygieneEnabled = true;
  mocks.settings.sessionHygieneHours = 24;
  mocks.settings.sessionPins = {};
  mocks.isSessionArchived.mockReturnValue(false);
  mocks.isSessionDeleted.mockReturnValue(false);
  mocks.isSessionKept.mockReturnValue(false);
});

describe("sweepStaleSessions 候选门控", () => {
  it("超期会话归档,时窗内不动", async () => {
    await sweep([entry("old", 25), entry("fresh", 1)]);
    expect(mocks.archiveSessions).toHaveBeenCalledWith(["ws1:omp:old"]);
  });

  it("时间未知(modifiedAt<=0)永不扫:grok/dsh 缺时间戳回 0", async () => {
    await sweep([entry("unknown", 0)]);
    expect(mocks.archiveSessions).not.toHaveBeenCalled();
  });

  it("活会话不归档", async () => {
    await sweep([entry("old", 30)], { liveCliIds: new Set(["old"]) });
    expect(mocks.archiveSessions).not.toHaveBeenCalled();
  });

  it("已归档/已删/保留/置顶 各自跳过(幂等 + 用户意图门控)", async () => {
    mocks.isSessionArchived.mockImplementation((k: string) => k.endsWith("arch"));
    mocks.isSessionDeleted.mockImplementation((k: string) => k.endsWith("del"));
    mocks.isSessionKept.mockImplementation((k: string) => k.endsWith("kept"));
    mocks.settings.sessionPins = { "ws1:omp:pin": { scope: "workspace" } };
    await sweep([
      entry("arch", 30),
      entry("del", 30),
      entry("kept", 30),
      entry("pin", 30),
      entry("ok", 30),
    ]);
    expect(mocks.archiveSessions).toHaveBeenCalledWith(["ws1:omp:ok"]);
  });

  it("开关关闭:整轮短路,零写入", async () => {
    mocks.settings.sessionHygieneEnabled = false;
    await sweep([entry("old", 48)]);
    expect(mocks.archiveSessions).not.toHaveBeenCalled();
  });

  it("时窗按设置生效(48h 窗下 30h 会话不动)", async () => {
    mocks.settings.sessionHygieneHours = 48;
    await sweep([entry("a", 30)]);
    expect(mocks.archiveSessions).not.toHaveBeenCalled();
    await sweep([entry("b", 49)]);
    expect(mocks.archiveSessions).toHaveBeenCalledWith(["ws1:omp:b"]);
  });

  it("无候选:不打空批量写", async () => {
    await sweep([entry("fresh", 1)]);
    expect(mocks.archiveSessions).not.toHaveBeenCalled();
  });
});

describe("sweepStaleSessions 空会话删除", () => {
  it("判空为真才删,返回删除数", async () => {
    const p = profile(true);
    expect(await sweep([entry("old", 30)], { profile: p })).toBe(1);
    expect(mocks.deleteDiskSessionFull).toHaveBeenCalledWith(p, expect.objectContaining({ id: "old" }), "ws1");
  });

  it("判空为假:只归档不删,返回 0", async () => {
    expect(await sweep([entry("old", 30)], { profile: profile(false) })).toBe(0);
    expect(mocks.archiveSessions).toHaveBeenCalledWith(["ws1:omp:old"]);
    expect(mocks.deleteDiskSessionFull).not.toHaveBeenCalled();
  });

  it("钩子缺省:只归档不删", async () => {
    expect(await sweep([entry("old", 30)], { profile: profile(null) })).toBe(0);
    expect(mocks.deleteDiskSessionFull).not.toHaveBeenCalled();
  });

  it("钩子抛错:吞掉不删(判不了不删)", async () => {
    const p = {
      id: "omp",
      isDiskSessionEmpty: vi.fn(async () => {
        throw new Error("io");
      }),
    } as unknown as CliProfile;
    expect(await sweep([entry("old", 30)], { profile: p })).toBe(0);
    expect(mocks.deleteDiskSessionFull).not.toHaveBeenCalled();
  });

  it("远程分支(allowDelete=false):归档但不碰删盘", async () => {
    expect(await sweep([entry("old", 30)], { profile: profile(true), allowDelete: false })).toBe(0);
    expect(mocks.archiveSessions).toHaveBeenCalledWith(["ws1:omp:old"]);
    expect(mocks.deleteDiskSessionFull).not.toHaveBeenCalled();
  });
});
