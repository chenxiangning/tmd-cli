/**
 * 会话删除助手契约测试(sessionOps.ts)。
 *
 * 覆盖活会话删除的时序契约(2026-09-07「删不掉」根因):
 * - 顺序即正确性:先 kill PTY 再删盘,流式中的 CLI 不再可能在缝隙里重开文件;
 * - 快照未命中兜底:懒落盘(omp 首写晚于 spawn 35s+)/补扫间隙里,扫描快照
 *   还没有该文件,必须现扫按身份反查,否则 kill 后文件幸存、重扫又列回来。
 * 删除意图原则(同日):后台删盘失败报错不阻塞管理态清理 —— 覆盖层照清、
 * tombstone 照记(列表全域隐藏),磁盘数据保留 + console.warn 诊断。
 * host/ipc 与覆盖层注入替身,不触真实模块。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import type { SessionMeta } from "@kernel/ipc";

const order: string[] = [];
const mocks = vi.hoisted(() => ({
  removeSession: vi.fn(),
  getCliSessionId: vi.fn(),
  fsRemovePath: vi.fn(),
  removeSessionTitle: vi.fn(),
  unpinSession: vi.fn(),
  unarchiveSession: vi.fn(),
  markSessionDeleted: vi.fn(),
}));
vi.mock("@kernel/host", () => ({
  host: {
    getCliSessionId: (id: string) => mocks.getCliSessionId(id),
    removeSession: mocks.removeSession,
  },
}));
vi.mock("@kernel/ipc", () => ({ ipc: { fsRemovePath: mocks.fsRemovePath } }));
vi.mock("@kernel/sessionTitles", () => ({ removeSessionTitle: mocks.removeSessionTitle }));
vi.mock("@kernel/sessionPins", () => ({
  sessionPinKey: () => "pin-key",
  unpinSession: mocks.unpinSession,
}));
vi.mock("@kernel/sessionArchive", () => ({
  sessionArchiveKey: () => "archive-key",
  unarchiveSession: mocks.unarchiveSession,
}));
vi.mock("@kernel/sessionDeleted", () => ({
  sessionDeletedKey: () => "delete-key",
  markSessionDeleted: mocks.markSessionDeleted,
}));

import { deleteDiskSessionFull, deleteLiveSessionFull } from "./sessionOps";

function mkProfile(overrides: Partial<CliProfile> = {}): CliProfile {
  return {
    id: "omp",
    listSessions: vi.fn(async () => []),
    ...overrides,
  } as unknown as CliProfile;
}

const liveSession = { id: "pty-1", profileId: "omp", cwd: "/repo" } as SessionMeta;
const diskEntry = (id: string, path: string): CliDiskSession => ({
  id,
  path,
  modifiedAt: 1,
});

beforeEach(() => {
  order.length = 0;
  vi.clearAllMocks();
  mocks.removeSession.mockImplementation(async (id: string) => {
    order.push(`kill:${id}`);
  });
  mocks.fsRemovePath.mockImplementation(async (path: string) => {
    order.push(`rm:${path}`);
  });
});

describe("deleteLiveSessionFull", () => {
  it("先 kill PTY 再删盘(SIGKILL 后文件不可能被重开)", async () => {
    mocks.getCliSessionId.mockReturnValue("cli-1");
    await deleteLiveSessionFull(mkProfile(), liveSession, "ws1", "/repo", [
      diskEntry("cli-1", "/repo/.omp/cli-1.jsonl"),
    ]);
    expect(order).toEqual(["kill:pty-1", "rm:/repo/.omp/cli-1.jsonl"]);
    expect(mocks.removeSessionTitle).toHaveBeenCalledWith("omp", "cli-1");
    expect(mocks.unpinSession).toHaveBeenCalledWith("pin-key");
    expect(mocks.unarchiveSession).toHaveBeenCalledWith("archive-key");
    expect(mocks.markSessionDeleted).toHaveBeenCalledWith("delete-key");
  });

  it("快照未命中:现扫按身份反查兜底再删盘", async () => {
    mocks.getCliSessionId.mockReturnValue("cli-late");
    const profile = mkProfile({
      listSessions: vi.fn(async () => [diskEntry("cli-late", "/repo/.omp/late.jsonl")]),
    });
    await deleteLiveSessionFull(profile, liveSession, "ws1", "/repo", []);
    expect(profile.listSessions).toHaveBeenCalledWith("/repo");
    expect(order).toEqual(["kill:pty-1", "rm:/repo/.omp/late.jsonl"]);
  });

  it("快照未命中且现扫也没有:只清覆盖层,不删任何路径", async () => {
    mocks.getCliSessionId.mockReturnValue("cli-miss");
    await deleteLiveSessionFull(mkProfile(), liveSession, "ws1", "/repo", []);
    expect(mocks.fsRemovePath).not.toHaveBeenCalled();
    expect(mocks.unarchiveSession).toHaveBeenCalledWith("archive-key");
  });

  it("未绑定(尚未落盘):只 kill,不扫盘不删文件不清覆盖层", async () => {
    mocks.getCliSessionId.mockReturnValue(undefined);
    const profile = mkProfile();
    await deleteLiveSessionFull(profile, liveSession, "ws1", "/repo", [
      diskEntry("other", "/repo/.omp/other.jsonl"),
    ]);
    expect(order).toEqual(["kill:pty-1"]);
    expect(profile.listSessions).not.toHaveBeenCalled();
    expect(mocks.removeSessionTitle).not.toHaveBeenCalled();
  });

  it("profile 未声明 listSessions 且快照未命中:kill 后跳过删盘", async () => {
    mocks.getCliSessionId.mockReturnValue("cli-x");
    await deleteLiveSessionFull(mkProfile({ listSessions: undefined }), liveSession, "ws1", "/repo", []);
    expect(order).toEqual(["kill:pty-1"]);
  });

  it("删除意图原则:后台删盘失败不抛,覆盖层照清 tombstone 照记(列表全域隐藏)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.getCliSessionId.mockReturnValue("cli-fail");
    mocks.fsRemovePath.mockRejectedValue(new Error("拒绝删除白名单外的路径"));
    await deleteLiveSessionFull(mkProfile(), liveSession, "ws1", "/repo", [
      diskEntry("cli-fail", "/repo/.omp/cli-fail.jsonl"),
    ]);
    expect(order).toEqual(["kill:pty-1"]);
    expect(mocks.removeSessionTitle).toHaveBeenCalledWith("omp", "cli-fail");
    expect(mocks.unpinSession).toHaveBeenCalledWith("pin-key");
    expect(mocks.unarchiveSession).toHaveBeenCalledWith("archive-key");
    expect(mocks.markSessionDeleted).toHaveBeenCalledWith("delete-key");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("deleteSession 钩子抛错同样不阻塞(opencode 单库形态)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const profile = mkProfile({
      listSessions: undefined,
      deleteSession: vi.fn(async () => {
        throw new Error("sqlite busy");
      }),
    });
    await deleteDiskSessionFull(profile, diskEntry("cli-e", "/repo/synthetic"), "ws1");
    expect(mocks.fsRemovePath).not.toHaveBeenCalled();
    expect(mocks.markSessionDeleted).toHaveBeenCalledWith("delete-key");
    expect(mocks.unarchiveSession).toHaveBeenCalledWith("archive-key");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("deleteDiskSessionFull", () => {
  it("删盘 + 清命名/置顶/归档覆盖层", async () => {
    await deleteDiskSessionFull(
      mkProfile({ listSessions: undefined }),
      diskEntry("cli-d", "/repo/.omp/d.jsonl"),
      "ws1",
    );
    expect(order).toEqual(["rm:/repo/.omp/d.jsonl"]);
    expect(mocks.unpinSession).toHaveBeenCalledWith("pin-key");
    expect(mocks.unarchiveSession).toHaveBeenCalledWith("archive-key");
    expect(mocks.markSessionDeleted).toHaveBeenCalledWith("delete-key");
  });
});
