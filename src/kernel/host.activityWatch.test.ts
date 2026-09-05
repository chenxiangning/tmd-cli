/**
 * 结算归因修正 + 重绘抑制窗 回归测试(2026-09-05)。
 *
 * 实证缺陷一(结算归因滞后):轮次结束靠「输出静默 >2s」判定,未读归属看结算瞬间
 * isViewing —— 用户看完回答、2s 窗内切走被误标未读;频繁切换放大命中。
 * 修正:归属锚定「最后一字节到达瞬间」是否正在查看。
 *
 * 实证缺陷二(SIGWINCH 重绘误燃):已锚定空闲会话收到真实 resize(拖 composer 后
 * 下一次切换的 stage 重放、开/关文件预览 tab、窗口缩放)→ TUI 整屏重绘
 * (实测 omp 一次 = 560KB 突发)→ 活动守望误判新一轮对话,生命周期重跑。
 * 修正:host.resizeSession 记时戳,resize 后 1s 抑制窗内的输出不进活动语义。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "./ipc";
import type { CliProfile } from "./cli";

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

const PROFILE_ID = "test-omp-activity";
const CWD = "/proj-activity";

const profile: CliProfile = {
  id: PROFILE_ID,
  name: "test",
  command: "true",
  args: [],
  triggers: [],
  readSessionStatus: async () => null,
  readDefaultStatus: async () => null,
};

describe("结算归因修正 + 重绘抑制窗", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessions.length = 0;
    ptyOutputCbs.clear();
    host.resetStatusTimerForTest();
    host.resetActivityWatchForTest();
    if (!host.getCliProfile(PROFILE_ID)) host.registerCliProfile(profile);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function fireOutput(sessionId: string, text = "chunk"): void {
    ptyOutputCbs.get(sessionId)?.(text);
  }

  /** 模拟用户发起一轮对话(真实路径:幕布按键/Composer 发送 → host.writeSession)。 */
  function userPrompt(sessionId: string): void {
    host.writeSession(sessionId, "prompt\r");
  }

  it("看完回答才切走(末字节到达时正在查看)→ 不标未读", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    const b = await host.createSession(PROFILE_ID, CWD);
    host.setActiveSession(a.id); // 查看 a
    userPrompt(a.id);
    fireOutput(a.id); // 末字节到达瞬间正在看 a
    host.setActiveSession(b.id); // 2s 结算窗前切走
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.isUnread(a.id)).toBe(false);
  });

  it("只看开头就切走(末字节到达时已不在看)→ 仍标未读", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    const b = await host.createSession(PROFILE_ID, CWD);
    host.setActiveSession(a.id);
    userPrompt(a.id);
    fireOutput(a.id, "start"); // 只看着开头
    host.setActiveSession(b.id); // 中途切走
    fireOutput(a.id, "tail"); // 末字节到达时不在看
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.isUnread(a.id)).toBe(true);
  });

  it("锚定空闲会话:resize 后 1s 窗内的输出 = 重绘,不推进活动钟不结算", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    await host.createSession(PROFILE_ID, CWD);
    userPrompt(a.id);
    fireOutput(a.id);
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.isUnread(a.id)).toBe(true);
    host.setActiveSession(a.id); // 点开已读
    expect(host.isUnread(a.id)).toBe(false);
    const settledAt = host.getLastActivityAt(a.id);

    host.resizeSession(a.id, 120, 40); // 自发 resize(真实 SIGWINCH 重绘的触发源)
    fireOutput(a.id, "redraw burst"); // 窗内重绘突发
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.getLastActivityAt(a.id)).toBe(settledAt); // 活动钟未推进
    expect(host.isUnread(a.id)).toBe(false); // 不重新打未读标签
  });

  it("resize 抑制窗之后的输出:正常点亮并按归因结算", async () => {
    const a = await host.createSession(PROFILE_ID, CWD);
    const b = await host.createSession(PROFILE_ID, CWD);
    userPrompt(a.id);
    fireOutput(a.id);
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.isUnread(a.id)).toBe(true);
    host.setActiveSession(a.id);

    host.resizeSession(a.id, 120, 40);
    await vi.advanceTimersByTimeAsync(1100); // 出抑制窗
    host.setActiveSession(b.id); // 切走:末字节到达时不在看
    fireOutput(a.id, "real answer");
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.isUnread(a.id)).toBe(true);
  });
});
