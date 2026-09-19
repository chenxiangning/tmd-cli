/**
 * 守望组合件(hostWatches)测试 —— 五守望 + 输出缓冲 + 身份账本的装配契约。
 *
 * 被测契约清单:
 * - ptyLiveTopic 格式(topic 与 sessionId 一一对应);
 * - appendOutput 主链路分流:实时 topic 广播、缓冲落盘(含默认上限截断与
 *   字节数/尾巴读取)、Ask 字节通道检测(ssh/shell 豁免)、busy/idle 标记
 *   分流(仅锚定会话)、EditWatch 事件分流与轮内去重;
 * - onUserWrite:非合成写入开轮(结算标未读/发 turnSettled)、合成写入
 *   (焦点/查询应答)恒 false 且不碰三守望;
 * - 身份账本绑定终审:成功绑定幂等、跨会话抢绑 fail-closed;
 * - 状态种子/观测分流:seeded → observed 来源分级;
 * - seedOutputBuffer 红线:只进存储不进守望主链;
 * - onSessionRemoved 生命周期:五守望 + 缓冲 + 账本残留一并清除。
 *
 * 直接构造 HostWatches(手写 HostWatchesCtx 桩 + 真 EventBus),不经 host
 * 单例;node 环境,依赖面(设置/localStorage)均有测试守卫,无需 mock。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus, KernelTopics } from "./events";
import { HostWatches, ptyLiveTopic } from "./hostWatches";
import type { CliProfile, CliSessionStatus } from "./cli";
import type { SessionMeta } from "./ipc";

const CWD = "/proj";

/** 手写 ctx 桩:会话表/profile 表/查看集/活跃 id 全部测试可控。 */
function makeWatches(profiles: CliProfile[] = []) {
  const sessions = new Map<string, SessionMeta>();
  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const viewing = new Set<string>();
  let activeId: string | null = null;
  const events = new EventBus();
  const notify = vi.fn();
  const hw = new HostWatches({
    getCliProfile: (id) => profileMap.get(id),
    findSession: (id) => sessions.get(id),
    hasSession: (id) => sessions.has(id),
    getActiveSessionId: () => activeId,
    isViewing: (id) => viewing.has(id),
    notify,
    events,
  });
  const addSession = (id: string, kind?: string) => {
    sessions.set(id, { id, profileId: profiles[0]?.id ?? "p", cwd: CWD, kind } as SessionMeta);
    return id;
  };
  return { hw, events, notify, addSession, viewing, setActive: (id: string | null) => { activeId = id; } };
}

/** 最小 CliProfile(标记面按用例传入)。 */
function makeProfile(marks: Partial<CliProfile> = {}): CliProfile {
  return { id: "pw-omp", name: "omp", command: "true", args: [], triggers: [], ...marks } as CliProfile;
}

describe("ptyLiveTopic", () => {
  it("topic 与 sessionId 一一对应且可反解", () => {
    expect(ptyLiveTopic("pty-1")).toBe("kernel.pty.live.pty-1");
    expect(ptyLiveTopic("a")).not.toBe(ptyLiveTopic("ab"));
  });
});

describe("appendOutput 主链路", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("原始字节进实时 topic、缓冲按序累计,字节数与尾巴读取一致", () => {
    const { hw, events, addSession } = makeWatches();
    const id = addSession("s1");
    const seen: string[] = [];
    events.on(ptyLiveTopic(id), (t) => seen.push(t as string));
    hw.appendOutput(id, "hello\r\n");
    hw.appendOutput(id, "world");
    expect(seen).toEqual(["hello\r\n", "world"]);
    expect(hw.getOutputBuffer(id)).toBe("hello\r\nworld");
    expect(hw.getOutputBufferBytes(id)).toBe(new TextEncoder().encode("hello\r\nworld").length);
    expect(hw.outputTail(id, 5)).toBe("world");
  });

  it("超出默认上限(50 万字符)截尾,保留尾部", () => {
    const { hw, addSession } = makeWatches();
    const id = addSession("s1");
    const big = "x".repeat(600_000) + "TAIL";
    hw.appendOutput(id, big);
    const buf = hw.getOutputBuffer(id);
    expect(buf.length).toBeLessThanOrEqual(500_000);
    expect(buf.endsWith("TAIL")).toBe(true);
  });

  it("Ask 字节通道:页脚标记复现确认升级等待并发 askDetected;用户写入即解除", () => {
    const { hw, events, addSession } = makeWatches();
    const id = addSession("s1");
    const asked: unknown[] = [];
    events.on(KernelTopics.askDetected, (p) => asked.push(p));
    const frame = "overwrite file? [y/N]\r\n";
    hw.appendOutput(id, frame);
    expect(hw.isWaiting(id)).toBe(false); // 首击只立候选
    vi.advanceTimersByTime(1_500); // 跨过候选确认窗(1.2s)
    hw.appendOutput(id, frame);
    expect(hw.isWaiting(id)).toBe(true);
    expect(asked).toEqual([id]);
    expect(hw.onUserWrite(id, false)).toBe(true); // 作答 = 等待翻转,Host 重渲染
    expect(hw.isWaiting(id)).toBe(false);
  });

  it("ssh 会话豁免 Ask 字节通道(输出即活动语义,不参与 CLI 面板检测)", () => {
    const { hw, addSession } = makeWatches();
    const id = addSession("ssh-1", "ssh");
    const frame = "proceed? [y/N]\r\n";
    hw.appendOutput(id, frame);
    vi.advanceTimersByTime(1_500);
    hw.appendOutput(id, frame);
    expect(hw.isWaiting(id)).toBe(false);
  });

  it("busy 标记持轮、idle 标记收口:锚定后轮次经 busy→idle 结束并标未读、发 turnSettled", async () => {
    const { hw, events, addSession } = makeWatches([
      makeProfile({ busyMarks: [/Working\.\.\./], idleMarks: [/status: idle/] }),
    ]);
    const id = addSession("s1");
    const settled: unknown[] = [];
    events.on(KernelTopics.turnSettled, (p) => settled.push(p));
    hw.onUserWrite(id, false); // 对话锚定 + 开轮
    vi.advanceTimersByTime(500); // 跨过应答回显窗
    hw.appendOutput(id, "Working...\r\n");
    vi.advanceTimersByTime(2_500);
    expect(hw.isTurnActive(id)).toBe(true); // busy 自证持轮(静默 2s 不结算)
    hw.appendOutput(id, "done. status: idle\r\n");
    await vi.advanceTimersByTimeAsync(4_000); // 空闲自证确认窗 + 结算 tick
    expect(hw.isTurnActive(id)).toBe(false);
    expect(hw.isUnread(id)).toBe(true); // 后台完成 = 未读
    expect(settled).toEqual([{ sessionId: id, unviewed: true, settledAt: expect.any(Number) }]);
    hw.markViewed(id);
    expect(hw.isUnread(id)).toBe(false);
  });

  it("EditWatch 事件分流:标记行发 fileEditDetected,轮内同路径去重,新轮清重报", () => {
    const { hw, events, addSession } = makeWatches([
      makeProfile({ editMarks: [/\bEdit\((\S+?)\)/] }),
    ]);
    const id = addSession("s1");
    const edits: unknown[] = [];
    events.on(KernelTopics.fileEditDetected, (p) => edits.push(p));
    hw.appendOutput(id, `Edit(${CWD}/src/a.ts) done\r\nEdit(${CWD}/src/a.ts) again\r\n`);
    expect(edits).toEqual([{ sessionId: id, paths: ["src/a.ts"] }]); // 同轮同路径只报一次
    hw.onUserWrite(id, false); // 新一轮:去重集清空
    hw.appendOutput(id, `Edit(${CWD}/src/a.ts) round2\r\n`);
    expect(edits).toHaveLength(2);
  });

  it("未声明 editMarks 的 profile 不启用 events 归因(零事件)", () => {
    const { hw, events, addSession } = makeWatches();
    const id = addSession("s1");
    const edits: unknown[] = [];
    events.on(KernelTopics.fileEditDetected, (p) => edits.push(p));
    hw.appendOutput(id, `Edit(${CWD}/src/a.ts)\r\n`);
    expect(edits).toEqual([]);
  });
});

describe("onUserWrite 合成写入闸", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("合成写入恒 false:不开轮,后续输出静默结算不标未读", async () => {
    const { hw, addSession } = makeWatches();
    const id = addSession("s1");
    expect(hw.onUserWrite(id, true)).toBe(false);
    hw.appendOutput(id, "answer\r\n");
    await vi.advanceTimersByTimeAsync(4_000);
    expect(hw.isTurnActive(id)).toBe(false);
    expect(hw.isUnread(id)).toBe(false); // 焦点/查询应答不得制造完成未读
  });
});

describe("身份账本绑定终审", () => {
  it("绑定成功且幂等;跨会话抢绑同一磁盘身份 fail-closed,原绑定不受扰", () => {
    const { hw, addSession } = makeWatches();
    const a = addSession("a");
    const b = addSession("b");
    expect(hw.bindIdentity(a, "disk-1")).toBe(true);
    expect(hw.getCliSessionId(a)).toBe("disk-1");
    expect(hw.bindIdentity(a, "disk-1")).toBe(true); // 重复注册幂等
    expect(hw.bindIdentity(b, "disk-1")).toBe(false); // 抢绑失败:新会话保持未绑定
    expect(hw.getCliSessionId(b)).toBeUndefined();
    expect(hw.getCliSessionId(a)).toBe("disk-1");
    expect(hw.bindIdentityForTest(b, "disk-2")).toBe(true); // 测试直通口同终审闸语义
  });

  it("身份探测登记不产生绑定(绑定只经账本终审入口)", () => {
    const { hw, addSession } = makeWatches();
    const id = addSession("s1");
    hw.identityTrack(id, "pw-omp", CWD, null, Date.now());
    expect(hw.getCliSessionId(id)).toBeUndefined();
    hw.onSessionRemoved(id); // 探测在册即移除:不得泄漏、不得事后绑上
  });
});

describe("状态种子与观测", () => {
  /** 微任务排干:seed/refresh 全链无计时器,只需让 await 链落地。 */
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  it("seed 记 CLI 默认(seeded);绑定后 refresh 读会话文件升 observed", async () => {
    let defaultStatus: CliSessionStatus | null = { model: "m-default" };
    let nextStatus: CliSessionStatus | null = { model: "m-live" };
    const { hw, addSession } = makeWatches([
      makeProfile({
        readDefaultStatus: async () => defaultStatus,
        readSessionStatus: async () => nextStatus,
      } as Partial<CliProfile>),
    ]);
    const id = addSession("s1");
    hw.statusSeed(id);
    await flush();
    expect(hw.getSessionStatus(id)).toEqual({ model: "m-default" });
    expect(hw.getSessionStatusSource(id)).toBe("seeded");
    hw.bindIdentity(id, "disk-9");
    hw.statusRefresh(id); // 非远程形态 → 落回本机会话文件观测
    await flush();
    await flush();
    expect(hw.getSessionStatus(id)).toEqual({ model: "m-live" });
    expect(hw.getSessionStatusSource(id)).toBe("observed");
    /* profile 读不到(null)时不清旧值,也不冒充观测 */
    nextStatus = null;
    hw.statusRefresh(id);
    await flush();
    await flush();
    expect(hw.getSessionStatusSource(id)).toBe("observed");
  });
});

describe("seedOutputBuffer 红线", () => {
  it("预灌只进存储:不进实时 topic、不推活动钟、不触 Ask/Edit 守望", () => {
    const { hw, events, notify, addSession } = makeWatches([
      makeProfile({ editMarks: [/\bEdit\((\S+?)\)/] }),
    ]);
    const id = addSession("s1");
    const seen: string[] = [];
    events.on(ptyLiveTopic(id), (t) => seen.push(t as string));
    hw.seedOutputBuffer(id, `welcome\r\nEdit(${CWD}/x.ts) [y/N]\r\n`);
    expect(hw.getOutputBuffer(id)).toContain("welcome");
    expect(seen).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    expect(hw.lastActivityAt(id)).toBe(0);
    expect(hw.isWaiting(id)).toBe(false);
  });
});

describe("onSessionRemoved 生命周期", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("五守望 + 缓冲 + 账本残留一并清除", () => {
    const { hw, addSession } = makeWatches();
    const id = addSession("s1");
    hw.bindIdentity(id, "disk-1");
    hw.appendOutput(id, "buffered\r\n");
    hw.onUserWrite(id, false);
    hw.appendOutput(id, "overwrite? [y/N]\r\n");
    vi.advanceTimersByTime(1_500);
    hw.appendOutput(id, "overwrite? [y/N]\r\n"); // 置等待态
    expect(hw.isWaiting(id)).toBe(true);

    hw.onSessionRemoved(id);
    expect(hw.getOutputBuffer(id)).toBe("");
    expect(hw.getOutputBufferBytes(id)).toBe(0);
    expect(hw.getCliSessionId(id)).toBeUndefined();
    expect(hw.isWaiting(id)).toBe(false);
    expect(hw.isUnread(id)).toBe(false);
    expect(hw.isTurnActive(id)).toBe(false);
    expect(hw.lastActivityAt(id)).toBe(0);
    expect(hw.getSessionStatus(id)).toBeUndefined();
  });
});
