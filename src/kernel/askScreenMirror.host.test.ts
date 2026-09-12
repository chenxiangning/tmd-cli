/**
 * 屏幕态镜像(askScreenMirror)host 接线测试 —— 后台(幕布未挂载)会话的
 * Ask 等待识别。修「等待确认只有打开 tab 才出现」:omp 等 TUI 的面板标记
 * 埋在整帧重绘的帧中部,字节通道逐 chunk 页脚窗评估结构性零命中(真实日志
 * 回放实证),后台会话只能靠镜像的屏幕采样。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "./ipc";
import type { TerminalHandle } from "./messageAnchors";

/* host 接线段:与 askWatch.host.test.ts 同款 ipc mock(静态 import 拿到的即 mock)。 */
const sessions: SessionMeta[] = [];
const ptyOutputCbs = new Map<string, (text: string) => void>();
const logBackends = new Map<string, string>();

vi.mock("./ipc", () => ({
  ipc: {
    sessionSpawn: vi.fn(async (profileId: string, spec: { cwd: string }) => {
      const id = `mirror-pty-${sessions.length + 1}`;
      sessions.push({ id, profileId, cwd: spec.cwd } as SessionMeta);
      return { id, pid: 5000 + sessions.length };
    }),
    sessionList: vi.fn(async () => sessions),
    sessionKill: vi.fn(async () => undefined),
    sessionWrite: vi.fn(async () => undefined),
    sessionLogSize: vi.fn(async (id: string) => logBackends.get(id)?.length ?? 0),
    sessionHistoryPage: vi.fn(async (id: string, _before: number, maxBytes: number) => {
      const log = logBackends.get(id) ?? "";
      return {
        text: log.slice(-maxBytes),
        startOffset: Math.max(0, log.length - maxBytes),
        hasMore: false,
      };
    }),
  },
  onPtyOutput: vi.fn(async (id: string, cb: (text: string) => void) => {
    ptyOutputCbs.set(id, cb);
    return () => ptyOutputCbs.delete(id);
  }),
  onPtyExit: vi.fn(async () => () => undefined),
}));

import { host } from "./host";
import { KernelTopics } from "./events";
import { registerTerminalHandle, unregisterTerminalHandle } from "./terminalHandles";

/** omp 整帧重绘形态:面板标记埋在帧中部,帧尾是提示框/状态栏 —— 字节通道
    逐 chunk 尾窗评估对此零命中(帧尾 5 行无任何标记字面量),唯有屏幕采样可见。 */
const OMP_FRAME = [
  ...Array.from({ length: 30 }, (_, i) => `transcript line ${i}\r\n`),
  "╭─── ? Ask ────────────────────────────────────────────╮\r\n",
  "│  横评广播的核心形态:发出同一 prompt 后,N 路结果怎么呈现?\r\n",
  "│  ◉ 活幕布真并排(推荐)\r\n",
  "│  ○ tab 轮播 + 汇总面板\r\n",
  "│  ○ 只读横评档案\r\n",
  "│  ○ Other (type your own)\r\n",
  "╰──────────────────────────────────────────────────────╯\r\n",
  "\r\n",
  "╰─\r\n",
  "mc: 72.9K (8%) · idle\r\n",
  "● spinner: ⚡ FULL\r\n",
].join("");

/** 幕布挂载桩(TerminalHandle 全成员;镜像只看注册表在不在,不调成员)。 */
function stubHandle(): TerminalHandle {
  return {
    lineText: () => "",
    bufferLength: () => 24,
    viewportTop: () => 0,
    rows: () => 24,
    scrollToLine: () => undefined,
    focus: () => undefined,
    onScroll: () => () => undefined,
    hasMoreHistory: () => false,
    loadEarlier: async () => undefined,
  };
}

describe("后台会话的屏幕态镜像(host 接线)", () => {
  const PROFILE_ID = "mirror-test-cli";
  const CWD = "/proj";

  beforeEach(() => {
    vi.useFakeTimers();
    sessions.length = 0;
    ptyOutputCbs.clear();
    logBackends.clear();
    if (!host.getCliProfile(PROFILE_ID)) {
      host.registerCliProfile({
        id: PROFILE_ID,
        name: "mirror-test",
        command: "true",
        args: [],
        triggers: [],
        askMarks: [
          /Ask \d+ questions?/,
          /Enter select\b/,
          /Esc(?: to)? cancel\b/,
          /Other \(type your own\)/,
        ],
      });
    }
  });

  afterEach(() => {
    host.resetStatusTimerForTest();
    host.resetActivityWatchForTest();
    vi.useRealTimers();
  });

  it("整帧重绘面板:字节通道零命中,后台会话经屏幕镜像置位等待 + askDetected", async () => {
    const detected: string[] = [];
    const off = host.events.on<string>(KernelTopics.askDetected, (id) => detected.push(id));
    const s = await host.createSession(PROFILE_ID, CWD);
    ptyOutputCbs.get(s.id)!(OMP_FRAME);
    expect(host.isWaitingConfirm(s.id)).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000); /* 首采样记起算,防抖窗未满 */
    expect(host.isWaitingConfirm(s.id)).toBe(false);
    await vi.advanceTimersByTimeAsync(2_500); /* 连续在场满 1.2s 防抖 → 置位 */
    expect(host.isWaitingConfirm(s.id)).toBe(true);
    expect(detected).toEqual([s.id]);
    off();
    await host.removeSession(s.id);
  });

  it("幕布挂载时镜像让位(不置位);卸载后镜像接管", async () => {
    const s = await host.createSession(PROFILE_ID, CWD);
    const handle = stubHandle();
    registerTerminalHandle(s.id, handle);
    ptyOutputCbs.get(s.id)!(OMP_FRAME);
    await vi.advanceTimersByTimeAsync(3_500);
    expect(host.isWaitingConfirm(s.id)).toBe(false); /* 真实幕布负责,镜像不抢 */
    unregisterTerminalHandle(s.id, handle);
    await vi.advanceTimersByTimeAsync(3_500);
    expect(host.isWaitingConfirm(s.id)).toBe(true); /* 幕布卸载,镜像补盲接管 */
    await host.removeSession(s.id);
  });

  it("会话移除:镜像随 PTY 消亡,面板字节不复活已删会话", async () => {
    const detected: string[] = [];
    const off = host.events.on<string>(KernelTopics.askDetected, (id) => detected.push(id));
    const s = await host.createSession(PROFILE_ID, CWD);
    ptyOutputCbs.get(s.id)!(OMP_FRAME);
    await host.removeSession(s.id);
    await vi.advanceTimersByTimeAsync(3_500);
    expect(host.isWaitingConfirm(s.id)).toBe(false);
    expect(detected).toEqual([]);
    off();
  });

  it("webview 重载 readopt:磁盘日志尾补底镜像,重载前挂起的面板直接置位", async () => {
    sessions.push({ id: "ghost-1", profileId: PROFILE_ID, cwd: CWD } as SessionMeta);
    logBackends.set("ghost-1", OMP_FRAME); /* 重载时刻面板已挂起:日志尾含整帧面板 */
    await host.readoptSessions();
    expect(host.isWaitingConfirm("ghost-1")).toBe(false);
    await vi.advanceTimersByTimeAsync(3_500);
    expect(host.isWaitingConfirm("ghost-1")).toBe(true);
    await host.removeSession("ghost-1");
  });
});
