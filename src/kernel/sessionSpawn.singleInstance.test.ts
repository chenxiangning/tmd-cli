/**
 * 单实例会话(SessionSpawnService.create × CliProfile.singleInstance)契约测试。
 *
 * 背景:dsh「会话即 host」,同 origin 第二个 `dsh web` 必然 EADDRINUSE 秒退
 * (codemoss ensure_host 复用活 host 同语义)。契约:
 * - 声明 singleInstance 的 profile:create 命中活会话 = 聚焦既有,不再 spawn;
 * - 并发双击由在途闸收口,绝不出两个 host;
 * - 未声明的 profile 行为不变(允许多实例)。
 * ipc 注入替身,不触真实 host(样板同 sessionSpawn.adopt.test.ts)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "./ipc";
import type { CliProfile } from "./cli";

/** 可控 spawn:计数 + 手动放行(在途闸用例);spawn 即登记,sessionList 回全表
 *  (装配活性检查要求 spawn 出的会话可被查到,否则按秒退竞态摘除)。 */
let spawnCount = 0;
let gate: Promise<void> | null = null;
const spawned: SessionMeta[] = [];
/** 预置活会话表(去重命中用例用)。 */
let listed: SessionMeta[] = [];

vi.mock("./ipc", () => ({
  ipc: {
    sessionSpawn: vi.fn(async (profileId: string, spec: { cwd: string }) => {
      spawnCount += 1;
      if (gate) await gate;
      const id = `pty-${spawnCount}`;
      spawned.push({ id, profileId, cwd: spec.cwd } as SessionMeta);
      return { id, pid: 100 + spawnCount };
    }),
    sessionList: vi.fn(async () => [...listed, ...spawned]),
  },
  onPtyOutput: vi.fn(async () => vi.fn()),
  onPtyExit: vi.fn(async () => vi.fn()),
}));

import { EventBus } from "./events";
import { SessionSpawnService } from "./sessionSpawn";

const singleProfile = {
  id: "test-host-cli",
  name: "test",
  command: "true",
  args: [],
  triggers: [],
  singleInstance: true,
} as unknown as CliProfile;

const plainProfile = {
  id: "test-plain-cli",
  name: "test",
  command: "true",
  args: [],
  triggers: [],
} as unknown as CliProfile;

function mkService(activeProfile: CliProfile) {
  let table: SessionMeta[] = [];
  const h = {
    getCliProfile: vi.fn(() => activeProfile),
    getSessions: vi.fn(() => table),
    setSessions: vi.fn((sessions: SessionMeta[]) => {
      table = sessions;
    }),
    findSession: vi.fn((id: string) => table.find((s) => s.id === id)),
    setActiveSessionId: vi.fn(),
    setActiveSession: vi.fn(),
    bindIdentity: vi.fn(() => true),
    getCliSessionId: vi.fn(() => undefined),
    identityTrack: vi.fn(),
    statusEnsurePolling: vi.fn(),
    statusRefresh: vi.fn(),
    statusSeed: vi.fn(),
    trackUnlisten: vi.fn(),
    outputTail: vi.fn(() => ""),
    appendOutput: vi.fn(),
    removeSession: vi.fn(async () => {}),
    notify: vi.fn(),
  };
  return { svc: new SessionSpawnService(h, new EventBus()), h };
}

beforeEach(() => {
  spawnCount = 0;
  gate = null;
  spawned.length = 0;
  listed = [];
});

describe("singleInstance create 去重", () => {
  it("已有活会话:create 聚焦既有,不再 spawn", async () => {
    const live = { id: "pty-live", profileId: "test-host-cli", cwd: "/proj" } as SessionMeta;
    const { svc, h } = mkService(singleProfile);
    h.setSessions([live]);
    const meta = await svc.create("test-host-cli", "/proj");
    expect(meta.id).toBe("pty-live");
    expect(h.setActiveSession).toHaveBeenCalledWith("pty-live");
    expect(spawnCount).toBe(0);
  });

  it("无活会话:正常 spawn 并装配", async () => {
    const { svc } = mkService(singleProfile);
    const meta = await svc.create("test-host-cli", "/proj");
    expect(meta.id).toBe("pty-1");
    expect(spawnCount).toBe(1);
  });

  it("并发双击:在途闸收口,只 spawn 一次", async () => {
    const { svc } = mkService(singleProfile);
    let release!: () => void;
    gate = new Promise<void>((r) => {
      release = r;
    });
    const first = svc.create("test-host-cli", "/proj");
    const second = svc.create("test-host-cli", "/proj");
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.id).toBe(b.id);
    expect(spawnCount).toBe(1);
  });

  it("未声明 singleInstance 的 profile:不去重,各自 spawn", async () => {
    const { svc } = mkService(plainProfile);
    const a = await svc.create("test-plain-cli", "/proj");
    const b = await svc.create("test-plain-cli", "/proj");
    expect(a.id).toBe("pty-1");
    expect(b.id).toBe("pty-2");
    expect(spawnCount).toBe(2);
  });
});
