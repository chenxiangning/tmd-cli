/**
 * AskWatch host 接线测试 —— 自 askWatch.test.ts 拆出(文件规模铁则收紧至 300 行)。
 * 覆盖:appendOutput 检测 → isWaitingConfirm/askDetected 事件、writeSession 作答清除、
 * 静默自愈、回放补观察(observeReplayTail)、removeSession 清理。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "./ipc";

/* host 接线段:与 host.test.ts 同款 ipc mock(静态 import 拿到的即 mock)。 */
const sessions: SessionMeta[] = [];
const ptyOutputCbs = new Map<string, (text: string) => void>();

vi.mock("./ipc", () => ({
  ipc: {
    sessionSpawn: vi.fn(async (profileId: string, spec: { cwd: string }) => {
      const id = `ask-pty-${sessions.length + 1}`;
      sessions.push({ id, profileId, cwd: spec.cwd } as SessionMeta);
      return { id, pid: 4000 + sessions.length };
    }),
    sessionList: vi.fn(async () => sessions),
    sessionKill: vi.fn(async () => undefined),
    sessionWrite: vi.fn(async () => undefined),
  },
  onPtyOutput: vi.fn(async (id: string, cb: (text: string) => void) => {
    ptyOutputCbs.set(id, cb);
    return () => ptyOutputCbs.delete(id);
  }),
  onPtyExit: vi.fn(async () => () => undefined),
}));

import { host } from "./host";
import { KernelTopics } from "./events";

/** omp Ask 面板样例(带 ANSI 样式,取自真实输出形态)。 */
const OMP_ASK =
  "\x1b[1mAsk 1 questions\x1b[0m\r\n\x1b[2m[plan_confirm] · options:3\x1b[0m";

/** 推过确认窗(1.2s)再触发输出评估的便捷步进。 */
async function pastConfirm() {
  await vi.advanceTimersByTimeAsync(1_300);
}

/** 测试用 CLI 声明标记(omp/pi-tui 卡片字面量;生产由 AskWatchFeed 经
    CliProfile.askMarks 注入,内核通用正则只留 y/n 与 Do you want)。 */
const TEST_ASK_MARKS: RegExp[] = [
  /Ask \d+ questions?/,
  /Enter select\b/,
  /Esc(?: to)? cancel\b/,
  /Other \(type your own\)/,
];
describe("host 接线:检测进主链路,状态对 UI 可读", () => {
  const PROFILE_ID = "ask-test-cli";
  const CWD = "/proj";

  beforeEach(() => {
    vi.useFakeTimers();
    sessions.length = 0;
    ptyOutputCbs.clear();
    if (!host.getCliProfile(PROFILE_ID)) {
      host.registerCliProfile({
        id: PROFILE_ID,
        name: "ask-test",
        command: "true",
        args: [],
        triggers: [],
        askMarks: TEST_ASK_MARKS,
      });
    }
  });

  afterEach(() => {
    host.resetStatusTimerForTest();
    host.resetActivityWatchForTest();
    vi.useRealTimers();
  });

  it("静态面板无复现:守望计时器静默确认 → askDetected + isWaitingConfirm", async () => {
    const detected: string[] = [];
    const off = host.events.on<string>(KernelTopics.askDetected, (id) =>
      detected.push(id),
    );
    const s = await host.createSession(PROFILE_ID, CWD);
    ptyOutputCbs.get(s.id)!(OMP_ASK); // 面板画完即静默,仅此一帧
    expect(host.isWaitingConfirm(s.id)).toBe(false);
    await vi.advanceTimersByTimeAsync(2_500); // 无任何后续输出,期满静默确认
    expect(host.isWaitingConfirm(s.id)).toBe(true);
    expect(detected).toEqual([s.id]);
    off();
    await host.removeSession(s.id);
  });

  it("提问面板复现确认 → askDetected 事件 + isWaitingConfirm;写入作答即清", async () => {
    const detected: string[] = [];
    const off = host.events.on<string>(KernelTopics.askDetected, (id) =>
      detected.push(id),
    );
    const s = await host.createSession(PROFILE_ID, CWD);
    ptyOutputCbs.get(s.id)!(OMP_ASK); // 首击立候选
    expect(host.isWaitingConfirm(s.id)).toBe(false);
    await pastConfirm();
    ptyOutputCbs.get(s.id)!(OMP_ASK); // 复现确认升级
    expect(host.isWaitingConfirm(s.id)).toBe(true);
    expect(detected).toEqual([s.id]);
    /* 重绘不重复发事件 */
    ptyOutputCbs.get(s.id)!(OMP_ASK);
    expect(detected).toHaveLength(1);
    /* 任何写入 = 作答(选择/回车/快捷键统一走 writeSession) */
    host.writeSession(s.id, "\r");
    expect(host.isWaitingConfirm(s.id)).toBe(false);
    /* 作答残影帧不置位 */
    ptyOutputCbs.get(s.id)!(OMP_ASK);
    expect(host.isWaitingConfirm(s.id)).toBe(false);
    off();
    await host.removeSession(s.id);
  });

  it("静默自愈:未锚定会话(无用户写入)的残留等待同样被摘除", async () => {
    const s = await host.createSession(PROFILE_ID, CWD);
    ptyOutputCbs.get(s.id)!(OMP_ASK);
    await pastConfirm();
    ptyOutputCbs.get(s.id)!(OMP_ASK);
    expect(host.isWaitingConfirm(s.id)).toBe(true);
    /* CLI 未等作答自行输出,响应把面板文本冲出页脚窗口后静默 → 自愈摘签 */
    ptyOutputCbs.get(s.id)!(
      "the cli continued\r\non its own with\r\nplenty of response lines\r\nto push the marker out\r\nof the footer window\r\n",
    );
    await vi.advanceTimersByTimeAsync(3_500);
    expect(host.isWaitingConfirm(s.id)).toBe(false);
    await host.removeSession(s.id);
  });

  it("回放补观察:webview 重载后静态面板经 observeReplayTail 恢复等待(标签+提示音事件)", async () => {
    const detected: string[] = [];
    const off = host.events.on<string>(KernelTopics.askDetected, (id) =>
      detected.push(id),
    );
    const s = await host.createSession(PROFILE_ID, CWD);
    ptyOutputCbs.get(s.id)!(OMP_ASK);
    await pastConfirm();
    ptyOutputCbs.get(s.id)!(OMP_ASK);
    expect(host.isWaitingConfirm(s.id)).toBe(true);
    /* 模拟 webview 重载:检测器内存态清零(PTY/输出缓冲仍在) */
    host.resetActivityWatchForTest();
    expect(host.isWaitingConfirm(s.id)).toBe(false);
    /* 幕布重挂载回放 → 补观察立候选;面板静态无新输出,漂移确认期满升级 */
    host.observeReplayTail(s.id);
    expect(host.isWaitingConfirm(s.id)).toBe(false);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(host.isWaitingConfirm(s.id)).toBe(true);
    expect(detected).toEqual([s.id, s.id]); /* 初次升级 + 重载后恢复各一次 */
    off();
    await host.removeSession(s.id);
  });

  it("回放补观察:尾巴无面板标记(早已作答)的会话零副作用", async () => {
    const s = await host.createSession(PROFILE_ID, CWD);
    ptyOutputCbs.get(s.id)!(
      OMP_ASK + "\r\nanswered\r\nresponse body here\r\nmore output\r\nkept flowing\r\ndone\r\n",
    ); /* 标记被 5 行尾随输出推出页脚窗口 = 早已作答的收尾形态 */
    host.observeReplayTail(s.id);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(host.isWaitingConfirm(s.id)).toBe(false);
    await host.removeSession(s.id);
  });

  it("会话移除 → 等待残留一并清除", async () => {
    const s = await host.createSession(PROFILE_ID, CWD);
    ptyOutputCbs.get(s.id)!(OMP_ASK);
    await pastConfirm();
    ptyOutputCbs.get(s.id)!(OMP_ASK);
    expect(host.isWaitingConfirm(s.id)).toBe(true);
    await host.removeSession(s.id);
    expect(host.isWaitingConfirm(s.id)).toBe(false);
  });
});
