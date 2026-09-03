/**
 * 绑定排他测试(共绑一 CLI 磁盘身份的竞态回归)。
 * 实证缺陷:四个会话共绑同一老磁盘会话 —— 内容证据路径的 claimed 快照
 * 取自 pickContentIdentity 慢读之前,await 期间被兄弟绑走也不知晓;自证
 * 无 createdAt 的候选(sole-eligible,无兄弟仲裁)人人可得。
 * 契约:一个 CLI 磁盘身份只准一个活会话持有(绑定落表前的同步再校验 +
 * host 绑定表唯一写入口终审);败者保持未绑定继续巡航,自己的文件晚出生
 * 仍可绑定(fail-closed,不猜)。
 *
 * host 是全局单例,跨用例共享 cliSessionIds —— 各用例磁盘身份 id 必须唯一
 * (与 host.test.ts 同规矩;本文件自带独立 id 前缀 t16-*)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "./ipc";
import type { CliDiskSession, CliProfile, CliSessionStatus } from "./cli";

let spawnSeq = 0;
const sessions: SessionMeta[] = [];

vi.mock("./ipc", () => ({
  ipc: {
    sessionSpawn: vi.fn(async (profileId: string, spec: { cwd: string }) => {
      spawnSeq += 1;
      const id = `pty-${spawnSeq}`;
      sessions.push({ id, profileId, cwd: spec.cwd } as SessionMeta);
      return { id, pid: 1000 + spawnSeq };
    }),
    sessionList: vi.fn(async () => sessions),
    sessionKill: vi.fn(async () => undefined),
    sessionWrite: vi.fn(async () => undefined),
  },
  onPtyOutput: vi.fn(async () => () => undefined),
  onPtyExit: vi.fn(async () => () => undefined),
}));

import { host } from "./host";

const CWD = "/proj";

/** 磁盘会话列表(mtime 倒序 = 新文件在前)。 */
let disk: CliDiskSession[] = [];

/** 内容慢读闸:让多个会话的探测同时停在 claimed 快照之后、绑定之前。 */
let readGate: PromiseWithResolvers<void> | null = null;

const contentProfile: CliProfile = {
  id: "excl-content",
  name: "excl-content",
  command: "true",
  args: [],
  triggers: [],
  listSessions: async () => disk,
  readSessionStatus: async () => null as unknown as CliSessionStatus,
  readSessionFileIdentity: async (path) => {
    if (readGate) await readGate.promise;
    const id = path.split("/").pop()?.replace(/\.jsonl$/, "") ?? null;
    return id ? { id } : null; // 无 createdAt:走 sole-eligible 直采路径
  },
};

function diskSession(id: string, modifiedAt = 0): CliDiskSession {
  return { id, path: `/dir/${id}.jsonl`, modifiedAt } as CliDiskSession;
}

async function advanceUntilBound(sessionId: string): Promise<string | undefined> {
  for (let i = 0; i < 35; i++) {
    await vi.advanceTimersByTimeAsync(500);
    const bound = host.getCliSessionId(sessionId);
    if (bound) return bound;
  }
  return undefined;
}

beforeEach(() => {
  vi.useFakeTimers();
  sessions.length = 0;
  disk = [];
  readGate = null;
  if (!host.getCliProfile("excl-content")) host.registerCliProfile(contentProfile);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("绑定排他(共绑一磁盘身份的竞态回归)", () => {
  it("claimed 快照过期:后到者不得重复绑定已被兄弟绑走的磁盘身份", async () => {
    const cwd = `${CWD}/exclusive`;
    const a = await host.createSession("excl-content", cwd);
    const b = await host.createSession("excl-content", cwd);

    /* 唯一的落盘文件;慢读闸让两会话的 claimed 快照都落在任何绑定之前 */
    disk = [diskSession("t16-only", Date.now())];
    readGate = Promise.withResolvers<void>();
    await vi.advanceTimersByTimeAsync(500);

    readGate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(host.getCliSessionId(a.id)).toBe("t16-only");
    expect(host.getCliSessionId(b.id)).toBeUndefined();
  });

  it("败者不报废:自己的文件晚出生仍可绑定", async () => {
    const cwd = `${CWD}/exclusive2`;
    const a = await host.createSession("excl-content", cwd);
    const b = await host.createSession("excl-content", cwd);

    disk = [diskSession("t16b-only", Date.now())];
    readGate = Promise.withResolvers<void>();
    await vi.advanceTimersByTimeAsync(500);
    readGate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(host.getCliSessionId(a.id)).toBe("t16b-only");
    expect(host.getCliSessionId(b.id)).toBeUndefined();

    /* B 自己的文件晚出生(claimed 集排除了 t16b-only)→ B 绑自己的 */
    disk = [diskSession("t16b-b", Date.now() + 1), diskSession("t16b-only", Date.now())];
    expect(await advanceUntilBound(b.id)).toBe("t16b-b");
    expect(host.getCliSessionId(a.id)).toBe("t16b-only");
  });

  it("绑定终审闸:同一磁盘会话已有活 PTY 时拒绝第二条绑定", async () => {
    const cwd = `${CWD}/reopen`;
    const first = await host.createSession("excl-content", cwd);
    disk = [diskSession("t16c-resume", Date.now())];
    expect(await advanceUntilBound(first.id)).toBe("t16c-resume");

    /* 模拟绕过入口去重的装配路径:explicit 绑定撞上已持身份 → 拒绝落表 */
    const dup = await host.createSession("excl-content", cwd);
    expect(host.bindIdentityForTest(dup.id, "t16c-resume")).toBe(false);
    expect(host.getCliSessionId(dup.id)).toBeUndefined();
    expect(host.getCliSessionId(first.id)).toBe("t16c-resume");
  });
});
