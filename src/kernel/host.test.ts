/**
 * host 会话身份绑定竞态回归测试。
 * 实证缺陷:detectDiskIdentity 绑定后不 return + 无认领机制 + 取最新文件,
 * 多会话同 cwd 的 15s 探测窗口重叠时身份被抢绑/交叉绑定,
 * 状态条模型/思考永久显示 "—"(refreshSessionStatus 读错文件或早退)。
 * 契约:绑定即终;并发 spawn 各绑各的(先 spawn 先认领最旧 fresh)。
 *
 * host 是全局单例,跨用例共享 cliSessionIds —— 各用例磁盘身份 id 必须唯一,
 * 防止认领集跨用例污染。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "./ipc";
import type { CliDiskSession, CliProfile, CliSessionStatus } from "./cli";

let spawnSeq = 0;
const sessions: SessionMeta[] = [];

/* vi.mock 由 vitest 提升于静态 import 之前,host 内部拿到的即 mock,无需动态 import */
vi.mock("./ipc", () => ({
  ipc: {
    /* 对齐真实行为:Rust 侧 session_spawn 同步注册,session_list 立即可见 */
    sessionSpawn: vi.fn(async (profileId: string, spec: { cwd: string }) => {
      spawnSeq += 1;
      const id = `pty-${spawnSeq}`;
      sessions.push({ id, profileId, cwd: spec.cwd } as SessionMeta);
      return { id, pid: 1000 + spawnSeq };
    }),
    sessionList: vi.fn(async () => sessions),
  },
  onPtyOutput: vi.fn(async () => () => undefined),
  onPtyExit: vi.fn(async () => () => undefined),
}));

import { host } from "./host";

const PROFILE_ID = "test-omp";
const CWD = "/proj";

/** 磁盘会话列表(可变,模拟 CLI 陆续落盘;mtime 倒序 = 新文件在前)。 */
let disk: CliDiskSession[] = [];

function diskSession(id: string): CliDiskSession {
  return { id, path: `/dir/${id}.jsonl`, modifiedAt: 0 } as CliDiskSession;
}

/** readSessionStatus 的可控返回:模拟 tail 扫描各时刻的观测结果。 */
let nextStatus: CliSessionStatus | null = null;

const profile: CliProfile = {
  id: PROFILE_ID,
  name: "test",
  command: "true",
  args: [],
  triggers: [],
  listSessions: async () => disk,
  readSessionStatus: async () => nextStatus,
};

/** 确定性驱动探测器(内部 500ms 轮询):逐格推进假时钟直到绑定或窗口耗尽。 */
async function advanceUntilBound(sessionId: string): Promise<string | undefined> {
  for (let i = 0; i < 35; i++) {
    await vi.advanceTimersByTimeAsync(500);
    const bound = host.getCliSessionId(sessionId);
    if (bound) return bound;
  }
  return undefined;
}

describe("detectDiskIdentity 身份绑定", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessions.length = 0;
    disk = [];
    if (!host.getCliProfile(PROFILE_ID)) host.registerCliProfile(profile);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("并发 spawn 同 cwd:先 spawn 认领最旧 fresh,互不串绑", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    const b = await host.createSession(PROFILE_ID, CWD);

    /* A 的文件先落盘 */
    disk = [diskSession("t1-fA")];
    expect(await advanceUntilBound(a.id)).toBe("t1-fA");

    /* B 的文件后落盘(新文件在前);t1-fA 已被 A 认领,B 必须绑 t1-fB */
    disk = [diskSession("t1-fB"), diskSession("t1-fA")];
    expect(await advanceUntilBound(b.id)).toBe("t1-fB");
  });

  it("绑定即终:探测窗口内出现更新文件不抢绑", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);

    disk = [diskSession("t2-fA")];
    expect(await advanceUntilBound(a.id)).toBe("t2-fA");

    /* 另一个新会话文件出现;推进整个 30×500ms 窗口,A 的身份不得改变 */
    disk = [diskSession("t2-fNew"), diskSession("t2-fA")];
    await vi.advanceTimersByTimeAsync(16_000);
    expect(host.getCliSessionId(a.id)).toBe("t2-fA");
  });
});

describe("refreshSessionStatus 字段级合并", () => {
  /* 实证缺陷:omp/pi 的 thinking_level_change 只在会话开头落盘一次,
     jsonl 超过 256KB 后滚出 tail 窗口 → 部分观测把已识别字段覆盖成 undefined,
     状态条思考(乃至模型)永久显示 "—"。
     契约:观测缺省 = 滚出窗口,保留旧值;新非空观测 = 真实切换,正常推进。 */
  beforeEach(() => {
    vi.useFakeTimers();
    sessions.length = 0;
    disk = [];
    nextStatus = null;
    if (!host.getCliProfile(PROFILE_ID)) host.registerCliProfile(profile);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** 重触发一次状态刷新(statusTimer 跨用例残留,2s 轮询不可靠,走 setActiveSession 路径)。 */
  async function refreshOnce(sessionId: string): Promise<void> {
    host.setActiveSession(null);
    host.setActiveSession(sessionId);
    await vi.advanceTimersByTimeAsync(0);
  }

  it("tail 观测缺省不抹既有字段;新非空观测正常推进", async () => {
    nextStatus = { model: "kimi-code/k3", thinkingLevel: "high" };
    const a = await host.createSession(PROFILE_ID, CWD);
    disk = [diskSession("t3-fA")];
    expect(await advanceUntilBound(a.id)).toBe("t3-fA");
    await vi.advanceTimersByTimeAsync(0); // 绑定后的首次 refresh 落库
    expect(host.getSessionStatus(a.id)).toEqual({
      model: "kimi-code/k3",
      thinkingLevel: "high",
    });

    /* thinking 滚出 tail:部分观测 → 保留旧值,不得覆盖成 undefined */
    nextStatus = { model: "kimi-code/k3", thinkingLevel: undefined };
    await refreshOnce(a.id);
    expect(host.getSessionStatus(a.id)).toEqual({
      model: "kimi-code/k3",
      thinkingLevel: "high",
    });

    /* 真实切换模型:新事件在 tail 内 → 非空观测正常推进 */
    nextStatus = { model: "minimax-code-cn/MiniMax-M3", thinkingLevel: undefined };
    await refreshOnce(a.id);
    expect(host.getSessionStatus(a.id)).toEqual({
      model: "minimax-code-cn/MiniMax-M3",
      thinkingLevel: "high",
    });

    /* 完全读不到(文件暂未落盘/读取失败)→ 全量保留 */
    nextStatus = null;
    await refreshOnce(a.id);
    expect(host.getSessionStatus(a.id)).toEqual({
      model: "minimax-code-cn/MiniMax-M3",
      thinkingLevel: "high",
    });
  });
});
