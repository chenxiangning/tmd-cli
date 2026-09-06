/**
 * 会话状态观测与内容证据身份绑定的回归测试(实现见 kernel/sessionStatus.ts、
 * kernel/diskIdentity.ts;host.ts 委托)。
 * fixture 与 host.test.ts 同构:同一 ipc mock 形状 + 可控 listSessions/status 实现。
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

const PROFILE_ID = "test-omp";
const CWD = "/proj";

/** 磁盘会话列表(可变,模拟 CLI 陆续落盘;mtime 倒序 = 新文件在前)。 */
let disk: CliDiskSession[] = [];

/** listSessions 的可控实现:模拟快照失败等异常路径。 */
let listImpl: () => Promise<CliDiskSession[]> = async () => disk;

function diskSession(id: string, modifiedAt = 0): CliDiskSession {
  return { id, path: `/dir/${id}.jsonl`, modifiedAt } as CliDiskSession;
}

/** readSessionStatus 的可控返回:模拟 tail 扫描各时刻的观测结果。 */
let nextStatus: CliSessionStatus | null = null;

/** readDefaultStatus 的可控返回:模拟 CLI 配置的默认模型/思考。 */
let defaultStatus: CliSessionStatus | null = null;

function resetStatusTimer(): void {
  host.resetStatusTimerForTest();
}

const profile: CliProfile = {
  id: PROFILE_ID,
  name: "test",
  command: "true",
  args: [],
  triggers: [],
  listSessions: () => listImpl(),
  readSessionStatus: async () => nextStatus,
  readDefaultStatus: async () => defaultStatus,
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

describe("创建即赋值与慢相位绑定", () => {
  /* 实证缺陷:omp 全新会话要等首条消息才落盘,15s 探测上限必然失明 → 模型/思考/额度永久 "—";
     且创建后、首条消息前工具栏无任何值。
     契约:创建即种 CLI 默认配置;磁盘真相落地后覆盖;探测会话不死不止(慢相位 2s 巡航)。 */
  beforeEach(() => {
    vi.useFakeTimers();
    resetStatusTimer();
    sessions.length = 0;
    disk = [];
    nextStatus = null;
    defaultStatus = null;
    listImpl = async () => disk;
    if (!host.getCliProfile(PROFILE_ID)) host.registerCliProfile(profile);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("创建即种默认状态;磁盘真相落地后覆盖种子", async () => {
    defaultStatus = { model: "minimax-code-cn/MiniMax-M3", thinkingLevel: "auto" };
    const a = await host.createSession(PROFILE_ID, CWD);
    await vi.advanceTimersByTimeAsync(0); // 种子异步落地
    expect(host.getSessionStatus(a.id)).toEqual({
      model: "minimax-code-cn/MiniMax-M3",
      thinkingLevel: "auto",
    });
    /* 来源分级:种子阶段 = "seeded",工具条据此显示「默认」角标 */
    expect(host.getSessionStatusSource(a.id)).toBe("seeded");

    /* 会话文件落盘(首条消息)→ 绑定 → 真实观测覆盖种子 */
    nextStatus = { model: "kimi-code/k3", thinkingLevel: "high" };
    disk = [diskSession("t8-fA", Date.now())];
    expect(await advanceUntilBound(a.id)).toBe("t8-fA");
    await vi.advanceTimersByTimeAsync(0);
    expect(host.getSessionStatus(a.id)).toEqual({
      model: "kimi-code/k3",
      thinkingLevel: "high",
    });
    expect(host.getSessionStatusSource(a.id)).toBe("observed");
  });

  it("种子值恰好等于观测值:值不变也必须翻来源(角标靠它摘除)", async () => {
    defaultStatus = { model: "kimi-code/k3", thinkingLevel: "high" };
    const a = await host.createSession(PROFILE_ID, CWD);
    await vi.advanceTimersByTimeAsync(0);
    expect(host.getSessionStatusSource(a.id)).toBe("seeded");

    /* 观测值与种子完全一致 → 值不变,但来源 seeded → observed 必须推进 */
    nextStatus = { model: "kimi-code/k3", thinkingLevel: "high" };
    disk = [diskSession("t8-equal", Date.now())];
    expect(await advanceUntilBound(a.id)).toBe("t8-equal");
    await vi.advanceTimersByTimeAsync(0);
    expect(host.getSessionStatus(a.id)).toEqual({
      model: "kimi-code/k3",
      thinkingLevel: "high",
    });
    expect(host.getSessionStatusSource(a.id)).toBe("observed");
  });

  it("快相位耗尽后文件才落盘:慢相位 2s 巡航绑上", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    await vi.advanceTimersByTimeAsync(16_000); // 快相位 30×500ms 耗尽
    expect(host.getCliSessionId(a.id)).toBeUndefined();

    /* 用户在第 16s 发出首条消息 → CLI 此刻才落盘 → 慢相位 2s 内绑上 */
    disk = [diskSession("t9-late", Date.now())];
    await vi.advanceTimersByTimeAsync(2_000);
    expect(host.getCliSessionId(a.id)).toBe("t9-late");
  });

  it("快照失败:水位线只认 post-spawn 增长", async () => {
    listImpl = async () => {
      throw new Error("io");
    };
    const a = await host.createSession(PROFILE_ID, CWD);
    listImpl = async () => disk;

    /* pre-spawn 旧文件:快相位+慢相位都不得抢绑 */
    disk = [diskSession("t10-old", 100)];
    await vi.advanceTimersByTimeAsync(18_000);
    expect(host.getCliSessionId(a.id)).toBeUndefined();

    /* 同文件 post-spawn 增长(本会话的迟到落盘/resume 复活):水位线放行 */
    disk = [diskSession("t10-old", Date.now())];
    await vi.advanceTimersByTimeAsync(2_000);
    expect(host.getCliSessionId(a.id)).toBe("t10-old");
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

    /* 真实切换模型:新事件在 tail 内 → 非空观测正常推进;
       模型变更 = 新时代,缺省的 thinking 不得延续旧值(跨代拼值) */
    nextStatus = { model: "minimax-code-cn/MiniMax-M3", thinkingLevel: undefined };
    await refreshOnce(a.id);
    expect(host.getSessionStatus(a.id)).toEqual({
      model: "minimax-code-cn/MiniMax-M3",
      thinkingLevel: undefined,
    });

    /* 同模型下 thinking 重新被观测 → 正常推进 */
    nextStatus = { model: "minimax-code-cn/MiniMax-M3", thinkingLevel: "max" };
    await refreshOnce(a.id);
    expect(host.getSessionStatus(a.id)).toEqual({
      model: "minimax-code-cn/MiniMax-M3",
      thinkingLevel: "max",
    });

    /* 完全读不到(文件暂未落盘/读取失败)→ 全量保留 */
    nextStatus = null;
    await refreshOnce(a.id);
    expect(host.getSessionStatus(a.id)).toEqual({
      model: "minimax-code-cn/MiniMax-M3",
      thinkingLevel: "max",
    });
  });
});
