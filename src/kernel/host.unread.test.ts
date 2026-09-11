/**
 * host 完成未读状态机测试(呼吸灯蓝态)—— 自 host.test.ts 拆出(文件规模铁则收紧至 300 行)。
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
import { bootSessionTabs, closeSessionTab, resetSessionTabsForTest } from "./sessionTabs";

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
describe("完成未读状态机(呼吸灯蓝态)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessions.length = 0;
    ptyOutputCbs.clear();
    disk = [];
    resetStatusTimer();
    host.resetActivityWatchForTest();
    resetSessionTabsForTest();
    bootSessionTabs(host.events); // 真实运行 main.tsx 接线;测试借它让会话持有 tab
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

  /* 真实 omp 空闲自绘帧(取自 ~/.tmd-cli/session/omp/… 日志尾部):OSC 标题重写
     + 光标寻址原地重绘,骨架恒定复现。回归 2026-09-11 实证 bug —— 此类字节
     曾吊住活动钟,轮次永不结算,侧栏标签永挂「运行时」。 */
  const IDLE_FRAMES = [
    "\u001b[0m\u001b[K\u001b[3;4H\u001b[?25h\u001b[?7h\u001b]0;⠹ Fix ask detection\u0007\u001b[?25l\u001b[?7l\u001b[1;1H\u001b[0m\u001b[K ⠹ · 与…  TOD\u001b[3;4H",
    "\u001b[0m\u001b[K\u001b[3;4H\u001b[?25h\u001b[?7h\u001b]0;⠼ Fix ask detection\u0007\u001b[?25l\u001b[?7l\u001b[1;1H\u001b[0m\u001b[K ⠼ · 与…  TOD\u001b[3;4H",
  ];

  it("空闲 spinner 自绘字节不吊住结算:轮次照常结束并标未读", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    await host.createSession(PROFILE_ID, CWD); // 后者活跃,a 在后台
    userPrompt(a.id);
    fireOutput(a.id, "answer text");

    // 回答结束后 CLI 以 ≈10Hz 持续自绘 20s(旧行为:活动钟被吊住,永挂运行时)
    for (let i = 0; i < 200; i++) {
      fireOutput(a.id, IDLE_FRAMES[i % IDLE_FRAMES.length]);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(host.isTurnActive(a.id)).toBe(false);
    expect(host.isUnread(a.id)).toBe(true); // 正常结算为「会话结束-未查看」
  });

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

  it("已了结会话关 tab 后:异步噪音不开轮、不推进活动钟(保持已查看)", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    userPrompt(a.id);
    fireOutput(a.id);
    await vi.advanceTimersByTimeAsync(3000); // 结算:正在查看 → 不标未读
    expect(host.isUnread(a.id)).toBe(false);
    const settledAt = host.getLastActivityAt(a.id);

    closeSessionTab(a.id); // 摘 tab,会话保持运行
    fireOutput(a.id, "async banner"); // hook/dreamer/更新横幅类异步字节
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.isTurnActive(a.id)).toBe(false); // 轮次未开
    expect(host.getLastActivityAt(a.id)).toBe(settledAt); // 活动钟未推进
    expect(host.isUnread(a.id)).toBe(false); // 保持已查看
  });

  it("在途轮次关 tab:输出照常推进,结算照标未读", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    await host.createSession(PROFILE_ID, CWD); // 后者活跃
    userPrompt(a.id);
    fireOutput(a.id); // 轮次在途
    closeSessionTab(a.id);
    fireOutput(a.id, "answer continues"); // 在途轮次不受闸影响
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.isUnread(a.id)).toBe(true);
  });

  it("写完即关 tab:首字节迟到也开轮,结算后噪音被闸挡", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    await host.createSession(PROFILE_ID, CWD);
    userPrompt(a.id);
    closeSessionTab(a.id);
    fireOutput(a.id, "late first byte"); // awaitingTurn 放行
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.isUnread(a.id)).toBe(true);

    fireOutput(a.id, "noise after settle"); // awaitingTurn 已随结算清除
    expect(host.isTurnActive(a.id)).toBe(false);
  });

  it("关 tab 后重新点开:轮次语义恢复", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    await host.createSession(PROFILE_ID, CWD);
    userPrompt(a.id);
    fireOutput(a.id);
    await vi.advanceTimersByTimeAsync(3000);
    closeSessionTab(a.id);
    host.setActiveSession(a.id); // 重新点开 = tab 恢复(activeSessionChanged → trackOpen)
    fireOutput(a.id, "new output");
    expect(host.isTurnActive(a.id)).toBe(true);
  });
});
