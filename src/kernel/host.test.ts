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

  /* 仲裁按 profile+cwd 作用域:本组用例各自独立 cwd,隔离用例间遗留的未绑定 pending;
     spawn 间用 setSystemTime 拉开时刻,使落盘 mtime 可落入明确窗口 */
  it("并行仲裁:落盘窗口属于老会话的文件,年轻会话让位", async () => {
    const cwd = `${CWD}/arb-steal`;
    const a = await host.createSession(PROFILE_ID, cwd);
    vi.setSystemTime(Date.now() + 1_000);
    const b = await host.createSession(PROFILE_ID, cwd);

    /* 文件落盘时刻在 A spawn 之后、B spawn 之前 → 窗口属于 A,B 必须让位 */
    disk = [diskSession("t11-fA", Date.now() - 500)];
    await vi.advanceTimersByTimeAsync(2_000);
    expect(host.getCliSessionId(a.id)).toBe("t11-fA");
    expect(host.getCliSessionId(b.id)).toBeUndefined();

    /* B 自己的文件落盘(窗口属于 B)→ B 绑自己的,不串到 t11-fA */
    disk = [diskSession("t11-fB", Date.now()), diskSession("t11-fA", Date.now() - 500)];
    expect(await advanceUntilBound(b.id)).toBe("t11-fB");
  });

  it("并行仲裁:复活文件归属不可判,年轻会话窗口内让位老会话", async () => {
    const cwd = `${CWD}/arb-revive`;
    /* A/B spawn 前旧文件已存在并进入双方基线 */
    disk = [diskSession("t12-old", 1_000)];
    const a = await host.createSession(PROFILE_ID, cwd);
    const b = await host.createSession(PROFILE_ID, cwd);

    /* 旧文件 mtime 增长(=A 的 CLI 在写);B 不得把它当自己的复活 */
    disk = [diskSession("t12-old", Date.now() + 1)];
    await vi.advanceTimersByTimeAsync(2_000);
    expect(host.getCliSessionId(a.id)).toBe("t12-old");
    expect(host.getCliSessionId(b.id)).toBeUndefined();
  });

  it("并行仲裁:窗口归属明确的文件不被闲置老会话阻塞", async () => {
    const cwd = `${CWD}/arb-expire`;
    const a = await host.createSession(PROFILE_ID, cwd); // 永不落盘(闲置)
    vi.setSystemTime(Date.now() + 1_000);
    const b = await host.createSession(PROFILE_ID, cwd);

    /* 文件落盘在 B spawn 之后 → 窗口明确属于 B,无需等 A,2s 内绑上 */
    disk = [diskSession("t13-fB", Date.now())];
    await vi.advanceTimersByTimeAsync(2_000);
    expect(host.getCliSessionId(b.id)).toBe("t13-fB");
    expect(host.getCliSessionId(a.id)).toBeUndefined();
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

  it("巡航相位:快相位耗尽后文件才落盘,后台会话(非激活)也绑上", async () => {
    /* omp 实证懒落盘:jsonl 出生晚于 spawn 35-44s,快相位 15s 必然扑空;
       旧逻辑慢相位只巡航激活会话,后台会话聚焦前永远绑不上(标题退化为应用短码) */
    const a = await host.createSession(PROFILE_ID, CWD);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(host.getCliSessionId(a.id)).toBeUndefined();

    disk = [diskSession("t14-cruise", Date.now())];
    await vi.advanceTimersByTimeAsync(5_000); // 巡航 5s 一格
    expect(host.getCliSessionId(a.id)).toBe("t14-cruise");
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

describe("首写闸:首写前输出不点亮呼吸灯", () => {
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

  it("首写前静默后的迟到突发也不结算(无对话会话永不亮灯)", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    await host.createSession(PROFILE_ID, CWD);
    fireOutput(a.id, "banner");
    await vi.advanceTimersByTimeAsync(3000);
    fireOutput(a.id, "late async message"); // resume 后迟到的 MCP/状态消息、重绘
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.isUnread(a.id)).toBe(false);
    expect(host.getLastActivityAt(a.id)).toBe(0);
  });

  it("终端协议回传不锚定对话:焦点/鼠标不点亮呼吸灯", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    await host.createSession(PROFILE_ID, CWD);
    /* 真实路径:TerminalView.onData 对焦点/鼠标上报标 synthetic(见 terminalReports.ts) */
    host.writeSession(a.id, "\x1b[I", true); // 焦点进入
    host.writeSession(a.id, "\x1b[<0;10;5M", true); // SGR 鼠标点击
    fireOutput(a.id, "redraw"); // TUI 因焦点/滚动重绘
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.isUnread(a.id)).toBe(false);
    expect(host.getLastActivityAt(a.id)).toBe(0);
  });

  it("用户首写锚定对话:应答按对话结算", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    await host.createSession(PROFILE_ID, CWD);
    host.writeSession(a.id, "hi\r");
    fireOutput(a.id, "answer");
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

  it("首写前输出不发结算事件(打开历史会话不得响结束音)", async () => {
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
