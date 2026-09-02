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
/** 捕获各会话的 PTY 输出回调:测试借此驱动 appendOutput(与真实接线同路径)。 */
const ptyOutputCbs = new Map<string, (text: string) => void>();

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
    sessionKill: vi.fn(async () => undefined),
    sessionWrite: vi.fn(async () => undefined),
  },
  onPtyOutput: vi.fn(async (id: string, cb: (text: string) => void) => {
    ptyOutputCbs.set(id, cb);
    return () => undefined;
  }),
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

/** 状态巡航 interval 是单例且跨用例残留;假时钟换届时必须清柄,否则慢相位永不着火。 */
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

describe("detectDiskIdentity 快照与复活", () => {
  /* 实证缺陷:CLI 内 /resume 追加写旧文件(无新文件落盘),探测永久失明;
     而 createSession 的 before 快照 .catch(() => []) 把失败静默降级为空集,
     findLast 抢到目录里最旧的别人会话 → 状态条张冠李戴(模型/思考/额度全部冻结在别的会话)。
     契约:快照失败 = 禁用探测(宁 "—" 勿错绑);快照后 mtime 增长的旧文件 = resume 目标;
     新文件优先于复活文件。 */
  beforeEach(() => {
    vi.useFakeTimers();
    sessions.length = 0;
    disk = [];
    listImpl = async () => disk;
    if (!host.getCliProfile(PROFILE_ID)) host.registerCliProfile(profile);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("快照失败 → 水位线探测:pre-spawn 旧文件不抢绑,post-spawn 增长可绑", async () => {
    listImpl = async () => {
      throw new Error("io");
    };
    const a = await host.createSession(PROFILE_ID, CWD);

    /* pre-spawn 旧文件(mtime 远小于水位线):绝不抢绑 */
    listImpl = async () => disk;
    disk = [diskSession("t6-foreign", 100)];
    await vi.advanceTimersByTimeAsync(16_000);
    expect(host.getCliSessionId(a.id)).toBeUndefined();
  });

  it("in-CLI /resume:快照后 mtime 增长的旧文件被识别为本会话", async () => {
    disk = [diskSession("t6-old", 100)];
    const a = await host.createSession(PROFILE_ID, CWD);

    /* resume 追加写旧文件:无新文件,mtime 增长 */
    disk = [diskSession("t6-old", 200)];
    expect(await advanceUntilBound(a.id)).toBe("t6-old");
  });

  it("新文件优先于复活文件:并发新会话不得误绑 resume 目标", async () => {
    disk = [diskSession("t7-old", 100)];
    const a = await host.createSession(PROFILE_ID, CWD);

    /* 本会话的全新文件与另一会话的 resume 复活同时出现 → 必须绑新文件 */
    disk = [diskSession("t7-new", 300), diskSession("t7-old", 200)];
    expect(await advanceUntilBound(a.id)).toBe("t7-new");
  });
});

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

    /* 会话文件落盘(首条消息)→ 绑定 → 真实观测覆盖种子 */
    nextStatus = { model: "kimi-code/k3", thinkingLevel: "high" };
    disk = [diskSession("t8-fA", Date.now())];
    expect(await advanceUntilBound(a.id)).toBe("t8-fA");
    await vi.advanceTimersByTimeAsync(0);
    expect(host.getSessionStatus(a.id)).toEqual({
      model: "kimi-code/k3",
      thinkingLevel: "high",
    });
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

describe("完成未读状态机(呼吸灯蓝态)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessions.length = 0;
    ptyOutputCbs.clear();
    disk = [];
    resetStatusTimer();
    host.resetActivityWatchForTest();
    if (!host.getCliProfile(PROFILE_ID)) host.registerCliProfile(profile);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** 模拟 PTY 输出(真实路径:onPtyOutput 回调 → appendOutput)。 */
  function fireOutput(sessionId: string, text = "chunk"): void {
    ptyOutputCbs.get(sessionId)?.(text);
  }

  /** 模拟用户发起一轮对话(真实路径:幕布按键/Composer 发送 → host.writeSession)。 */
  function userPrompt(sessionId: string): void {
    host.writeSession(sessionId, "prompt\r");
  }

  it("对话结束且未被查看 → 标未读;点开查看即清", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    const b = await host.createSession(PROFILE_ID, CWD);
    /* B 后创建 = 当前查看;A 在后台跑完一轮对话 */
    userPrompt(a.id);
    fireOutput(a.id);
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.isUnread(a.id)).toBe(true);
    expect(host.isUnread(b.id)).toBe(false);

    host.setActiveSession(a.id);
    expect(host.isUnread(a.id)).toBe(false);
  });

  it("正在查看的会话结束 → 不标未读(不打扰)", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    /* a 即当前查看会话;其对话结束不应产生未读 */
    userPrompt(a.id);
    fireOutput(a.id);
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.isUnread(a.id)).toBe(false);
  });

  it("未读会话来新输出 → 立即回到进行中(清未读)", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    await host.createSession(PROFILE_ID, CWD);
    userPrompt(a.id);
    fireOutput(a.id);
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.isUnread(a.id)).toBe(true);

    fireOutput(a.id, "new turn");
    expect(host.isUnread(a.id)).toBe(false);
  });

  it("输出间隔 ≤2s 视为同一轮:不提前结算未读", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    await host.createSession(PROFILE_ID, CWD);
    userPrompt(a.id);
    fireOutput(a.id);
    await vi.advanceTimersByTimeAsync(1500);
    fireOutput(a.id, "still streaming");
    await vi.advanceTimersByTimeAsync(1500);
    /* 距上次输出仅 1.5s,轮次未结束 */
    expect(host.isUnread(a.id)).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(host.isUnread(a.id)).toBe(true);
  });

  it("会话移除 → 未读/轮次残留一并清除", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    await host.createSession(PROFILE_ID, CWD);
    userPrompt(a.id);
    fireOutput(a.id);
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.isUnread(a.id)).toBe(true);

    await host.removeSession(a.id);
    expect(host.isUnread(a.id)).toBe(false);
  });
});

describe("宽限期:spawn 首个输出突发不结算(呼吸灯灰)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessions.length = 0;
    ptyOutputCbs.clear();
    disk = [];
    resetStatusTimer();
    host.resetActivityWatchForTest();
    if (!host.getCliProfile(PROFILE_ID)) host.registerCliProfile(profile);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function fireOutput(sessionId: string, text = "chunk"): void {
    ptyOutputCbs.get(sessionId)?.(text);
  }

  it("新会话横幅输出:不亮灯、不结算未读", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    await host.createSession(PROFILE_ID, CWD);
    fireOutput(a.id, "banner");
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.isUnread(a.id)).toBe(false);
    expect(host.getLastActivityAt(a.id)).toBe(0);
  });

  it("历史会话 resume 回放:全程不结算,切走也不标蓝", async () => {
    const other = await host.createSession(PROFILE_ID, CWD); // 当前查看
    const h = await host.openDiskSession(PROFILE_ID, CWD, undefined, "resume-1");
    fireOutput(h.id, "replay..."); // CLI 重绘历史
    host.setActiveSession(other.id); // 回放未结束即切走
    fireOutput(h.id, "more replay");
    await vi.advanceTimersByTimeAsync(4000);
    expect(host.isUnread(h.id)).toBe(false);
  });

  it("用户首写立即出宽限:应答按对话结算", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    await host.createSession(PROFILE_ID, CWD);
    host.writeSession(a.id, "hi\r");
    fireOutput(a.id, "answer");
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.isUnread(a.id)).toBe(true);
  });

  it("宽限静默后的新突发 = 正常对话(慢启动 CLI 语义)", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    await host.createSession(PROFILE_ID, CWD);
    fireOutput(a.id, "banner"); // 宽限内:静默 2s 后出宽限
    await vi.advanceTimersByTimeAsync(3000);
    fireOutput(a.id, "late turn"); // 无写入的后续输出:正常结算
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.isUnread(a.id)).toBe(true);
  });
});

describe("turnSettled 结算事件(结束音数据源)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessions.length = 0;
    ptyOutputCbs.clear();
    disk = [];
    resetStatusTimer();
    host.resetActivityWatchForTest();
    if (!host.getCliProfile(PROFILE_ID)) host.registerCliProfile(profile);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("真实轮次结算发事件:未查看带 unviewed=true,正在查看 false", async () => {
    const settled: { sessionId: string; unviewed: boolean }[] = [];
    const off = host.events.on<{
      sessionId: string;
      unviewed: boolean;
      settledAt: number;
    }>("kernel.sessions.turn.settled", (e) => settled.push(e));

    const a = await host.createSession(PROFILE_ID, CWD); // 后台
    const b = await host.createSession(PROFILE_ID, CWD); // 查看
    host.writeSession(a.id, "q\r");
    host.writeSession(b.id, "q\r");
    ptyOutputCbs.get(a.id)?.("answer-a");
    ptyOutputCbs.get(b.id)?.("answer-b");
    await vi.advanceTimersByTimeAsync(3000);
    off();

    expect(settled).toHaveLength(2);
    expect(settled.find((e) => e.sessionId === a.id)?.unviewed).toBe(true);
    expect(settled.find((e) => e.sessionId === b.id)?.unviewed).toBe(false);
    expect(host.isUnread(a.id)).toBe(true);
  });

  it("宽限静默退出不发事件(打开历史会话不得响结束音)", async () => {
    const settled: unknown[] = [];
    const off = host.events.on("kernel.sessions.turn.settled", (e) => settled.push(e));
    await host.createSession(PROFILE_ID, CWD);
    const h = await host.openDiskSession(PROFILE_ID, CWD, undefined, "resume-2");
    ptyOutputCbs.get(h.id)?.("replay");
    await vi.advanceTimersByTimeAsync(4000);
    off();
    expect(settled).toHaveLength(0);
  });
});
