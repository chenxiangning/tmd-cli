/**
 * omp 预热接管契约测试 —— 状态机全链路(mock ipc + fake timers):
 * 命中注入序列(整行 → 150ms → 单发 \r)、特征检测、转正解除影子登记、
 * 补货调度、特征超时熔断、进程死亡清场、出生空会话文件清理(有用户消息绝不删)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const outputCbs = new Map<string, (text: string) => void>();
const exitCbs = new Map<string, () => void>();
let bucketFiles: Array<{ name: string; path: string; modifiedAt: number }> = [];
let rootFiles: Array<{ name: string; path: string; modifiedAt: number }> = [];
let headByPath = new Map<string, string>();
let spawnSeq = 0;
const spawnedIds: string[] = [];

vi.mock("@kernel/ipc", () => ({
  ipc: {
    configHomeDir: vi.fn(async () => "/home/u"),
    fsCollectFiles: vi.fn(async (dir: string) =>
      dir === "/home/u/.omp/agent/sessions" ? rootFiles : bucketFiles,
    ),
    fsReadHead: vi.fn(async (path: string) => headByPath.get(path) ?? ""),
    fsRemovePath: vi.fn(async () => undefined),
    sessionSpawn: vi.fn(async () => {
      spawnSeq += 1;
      const id = `pw-${spawnSeq}`;
      spawnedIds.push(id);
      return { id };
    }),
    sessionWrite: vi.fn(async () => undefined),
    sessionKill: vi.fn(async () => undefined),
  },
  onPtyOutput: vi.fn(async (id: string, cb: (text: string) => void) => {
    outputCbs.set(id, cb);
    return () => {
      outputCbs.delete(id);
    };
  }),
  onPtyExit: vi.fn(async (id: string, cb: () => void) => {
    exitCbs.set(id, cb);
    return () => {
      exitCbs.delete(id);
    };
  }),
}));

vi.mock("./edits", () => ({
  ompSessionsDir: vi.fn(async () => "/home/u/.omp/agent/sessions/-w"),
}));

import { ipc } from "@kernel/ipc";
import { isShadowedSession, clearShadowSessionsForTest } from "@kernel/sessionShadowing";
import {
  ompAcquireResume,
  resetOmpPrewarmForTest,
  startOmpPrewarmManager,
  stopOmpPrewarmManager,
} from "./prewarm";

const CWD = "/w";
const START_DELAY = 8_000;
const READY_DELAY = 6_000;
const REFILL_DELAY = 3_000;
const RESUME_TIMEOUT = 5_000;

function feed(id: string, text: string): void {
  outputCbs.get(id)?.(text);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetOmpPrewarmForTest();
  clearShadowSessionsForTest();
  outputCbs.clear();
  exitCbs.clear();
  bucketFiles = [];
  headByPath = new Map();
  spawnSeq = 0;
  spawnedIds.length = 0;
  rootFiles = [
    {
      name: "2026-09-01T00-00-00-000Z_01a.jsonl",
      path: "/home/u/.omp/agent/sessions/-w/2026-09-01T00-00-00-000Z_01a.jsonl",
      modifiedAt: Date.now(),
    },
  ];
  headByPath.set(rootFiles[0].path, '{"type":"header","cwd":"/w"}');
  vi.mocked(ipc.sessionWrite).mockClear();
  vi.mocked(ipc.sessionKill).mockClear();
  vi.mocked(ipc.fsRemovePath).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

/** 驱动到预热就绪:start → 延迟 → 发现 cwd → spawn → 就绪窗。 */
async function warmToReady(): Promise<string> {
  startOmpPrewarmManager();
  await vi.advanceTimersByTimeAsync(START_DELAY);
  await vi.advanceTimersByTimeAsync(READY_DELAY);
  const id = spawnedIds.at(-1);
  if (!id) throw new Error("预热进程未 spawn");
  return id;
}

/** fake timers 下推进 acquire 轮询循环(其 sleep 需 timer 推进才醒)直至 settle。 */
async function settle(p: Promise<unknown>): Promise<void> {
  for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(100);
  await p;
}

describe("omp 预热接管", () => {
  it("池空 / 未就绪 → null 降级", async () => {
    expect(await ompAcquireResume(CWD, "sess-1")).toBeNull();
    startOmpPrewarmManager();
    await vi.advanceTimersByTimeAsync(START_DELAY);
    /* 刚 spawn 尚未就绪 */
    expect(await ompAcquireResume(CWD, "sess-1")).toBeNull();
  });

  it("cwd 不匹配 → null(omp 热切换的 cwd 硬约束)", async () => {
    await warmToReady();
    expect(await ompAcquireResume("/other", "sess-1")).toBeNull();
  });

  it("命中:注入序列(整行 → 150ms → \\r)、特征转正、解除影子、补货", async () => {
    const id = await warmToReady();
    expect(isShadowedSession(id)).toBe(true);
    const acquired = ompAcquireResume(CWD, "sess-42");
    await vi.advanceTimersByTimeAsync(150 + 60);
    const writes = vi.mocked(ipc.sessionWrite).mock.calls.map((c) => c[1]);
    expect(writes).toEqual([`/resume sess-42`, "\r"]);
    feed(id, "\x1b[2J\x1b[H");
    feed(id, "\x1b[1mResumed session\x1b[0m");
    await settle(acquired);
    const result = await acquired;
    expect(result?.sessionId).toBe(id);
    expect(result?.replayTail).toContain("Resumed session");
    expect(isShadowedSession(id)).toBe(false);
    /* 补货:消费后重新预热一个 */
    await vi.advanceTimersByTimeAsync(REFILL_DELAY + 100);
    expect(spawnedIds).toHaveLength(2);
  });

  it("check-out 原子:就绪池只消费一次,第二次 null", async () => {
    await warmToReady();
    const first = ompAcquireResume(CWD, "sess-1");
    await vi.advanceTimersByTimeAsync(200);
    expect(await ompAcquireResume(CWD, "sess-2")).toBeNull();
    feed(spawnedIds[0], "Resumed session");
    await settle(first);
  });

  it("特征超时 → 强杀 + 熔断:本运行周期不再预热也不再接管", async () => {
    const id = await warmToReady();
    const acquired = ompAcquireResume(CWD, "sess-1");
    await vi.advanceTimersByTimeAsync(150 + RESUME_TIMEOUT + 200);
    expect(await acquired).toBeNull();
    expect(ipc.sessionKill).toHaveBeenCalledWith(id);
    /* 熔断:重启管理器也不得再 spawn */
    stopOmpPrewarmManager();
    startOmpPrewarmManager();
    await vi.advanceTimersByTimeAsync(START_DELAY + READY_DELAY + 100);
    expect(spawnedIds).toHaveLength(1);
    expect(await ompAcquireResume(CWD, "sess-1")).toBeNull();
  });

  it("进程死亡(exit 回调)→ 清场解登记,acquire 降级", async () => {
    const id = await warmToReady();
    exitCbs.get(id)?.();
    expect(isShadowedSession(id)).toBe(false);
    expect(await ompAcquireResume(CWD, "sess-1")).toBeNull();
  });

  it("出生文件锁定窗窄删:单新增且空才删;多新增(用户同时手开)全不碰", async () => {
    startOmpPrewarmManager();
    /* spawn 已发生(START_DELAY 后),出生锁定窗(2s)未到:桶里出现新增 */
    await vi.advanceTimersByTimeAsync(START_DELAY + 100);
    bucketFiles = [{ name: "born-empty.jsonl", path: "/b/born-empty.jsonl", modifiedAt: Date.now() }];
    headByPath.set("/b/born-empty.jsonl", '{"type":"header"}');
    await vi.advanceTimersByTimeAsync(2_000 + 100);
    expect(vi.mocked(ipc.fsRemovePath).mock.calls.map((c) => c[0])).toEqual([
      "/b/born-empty.jsonl",
    ]);
  });

  it("出生文件锁定窗:多新增一个也不删(无法安全归因,宁残留)", async () => {
    startOmpPrewarmManager();
    await vi.advanceTimersByTimeAsync(START_DELAY + 100);
    bucketFiles = [
      { name: "a.jsonl", path: "/b/a.jsonl", modifiedAt: Date.now() },
      { name: "b.jsonl", path: "/b/b.jsonl", modifiedAt: Date.now() },
    ];
    headByPath.set("/b/a.jsonl", '{"type":"header"}');
    headByPath.set("/b/b.jsonl", '{"type":"header"}');
    await vi.advanceTimersByTimeAsync(2_000 + 5_000 + 100);
    expect(vi.mocked(ipc.fsRemovePath)).not.toHaveBeenCalled();
  });

  it("出生文件锁定窗:单新增但含用户消息(真实会话)绝不删", async () => {
    startOmpPrewarmManager();
    await vi.advanceTimersByTimeAsync(START_DELAY + 100);
    bucketFiles = [{ name: "real.jsonl", path: "/b/real.jsonl", modifiedAt: Date.now() }];
    headByPath.set("/b/real.jsonl", '{"message":{"role":"user","content":"hi"}}');
    await vi.advanceTimersByTimeAsync(2_000 + 5_000 + 100);
    expect(vi.mocked(ipc.fsRemovePath)).not.toHaveBeenCalled();
  });

  it("近期无 omp 会话活动 → 不预热", async () => {
    rootFiles[0] = { ...rootFiles[0], modifiedAt: Date.now() - 30 * 24 * 3_600_000 };
    startOmpPrewarmManager();
    await vi.advanceTimersByTimeAsync(START_DELAY + READY_DELAY + 100);
    expect(spawnedIds).toHaveLength(0);
  });

  it("待命超时回收:10 分钟未消费强杀并清登记", async () => {
    const id = await warmToReady();
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 100);
    expect(ipc.sessionKill).toHaveBeenCalledWith(id);
    expect(isShadowedSession(id)).toBe(false);
  });

  it("注入写失败 → 强杀清场降级 null(未熔断:传输错不是语义错)", async () => {
    await warmToReady();
    vi.mocked(ipc.sessionWrite).mockRejectedValueOnce(new Error("pipe closed"));
    expect(await ompAcquireResume(CWD, "sess-1")).toBeNull();
    expect(ipc.sessionKill).toHaveBeenCalledWith(spawnedIds[0]);
    /* 写失败 ≠ 特征失配,不熔断:重启管理器仍可预热 */
    stopOmpPrewarmManager();
    startOmpPrewarmManager();
    await vi.advanceTimersByTimeAsync(START_DELAY + READY_DELAY + 100);
    expect(spawnedIds).toHaveLength(2);
  });

  it("注入等待期进程退出 → exit 回调唤醒等待方,降级 null", async () => {
    const id = await warmToReady();
    const acquired = ompAcquireResume(CWD, "sess-1");
    await vi.advanceTimersByTimeAsync(200);
    exitCbs.get(id)?.();
    expect(await acquired).toBeNull();
  });

  it("spawn 落地即影子登记(未就绪期已被会话表过滤)", async () => {
    startOmpPrewarmManager();
    await vi.advanceTimersByTimeAsync(START_DELAY + 100);
    expect(spawnedIds).toHaveLength(1);
    expect(isShadowedSession(spawnedIds[0])).toBe(true);
  });

  it("全局最近会话文件缺失 cwd 字段 → 放弃预热(不猜)", async () => {
    headByPath.set(rootFiles[0].path, '{"type":"title"}');
    startOmpPrewarmManager();
    await vi.advanceTimersByTimeAsync(START_DELAY + READY_DELAY + 100);
    expect(spawnedIds).toHaveLength(0);
  });
});
