/**
 * host 首写闸与 turnSettled 结算事件测试 —— 自 host.test.ts 拆出(文件规模铁则收紧至 300 行)。
 * fixture 与 host.test.ts 同构:同一 ipc mock 形状 + 可控 listSessions/status 实现。
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
    sessionResize: vi.fn(async () => undefined),
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
    await vi.advanceTimersByTimeAsync(500); // 跨过应答回显窗:后续内容算应答证据
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
    await vi.advanceTimersByTimeAsync(500); // 跨过应答回显窗:后续内容算应答证据
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
