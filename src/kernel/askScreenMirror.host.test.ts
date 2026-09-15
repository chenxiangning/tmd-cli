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
        busyMarks: [/\d+[sm] >/u],
        /* pi-tui 用户回显行实采形态(引号灰斜体行;生产声明见 cli-shared/echoMarks.ts)。 */
        echoMarks: [/\u001b\[3;(?:\d+;)*\d+m"/],
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

  /* 2026-09-15 实证:webview 重载清空前端态,重载前在途轮次丢锚即落空闲且
     I2 拦后续输出永不自愈;readopt 经磁盘尾用户回显行重锚恢复因果。 */
  const ECHO_LINE = '\u001b[33;1H\u001b[0m\u001b[K \u001b[3;38;2;156;163;176m"校准会话状态"\u001b[39;23m\r\n';
  const IDLE_LINE = "\u001b[0m\u001b[Kmc: 69.7K (8%) · idle\u001b[0m\r\n";

  it("readopt 重锚:重载前在途轮次恢复运行中,静默工具段持轮,应答到达照常结算", async () => {
    sessions.push({ id: "ghost-2", profileId: PROFILE_ID, cwd: CWD } as SessionMeta);
    logBackends.set("ghost-2", IDLE_LINE + ECHO_LINE + IDLE_LINE); /* 尾含用户回显行 */
    await host.readoptSessions();
    expect(host.isTurnActive("ghost-2")).toBe(true);
    await vi.advanceTimersByTimeAsync(25_000); // 重载后紧邻静默工具:自证窗持轮
    expect(host.isTurnActive("ghost-2")).toBe(true);
    ptyOutputCbs.get("ghost-2")!("answer tail"); // 应答到达续轮
    await vi.advanceTimersByTimeAsync(6_000); // 自证窗 30s 出窗(锚后 31s)
    expect(host.isTurnActive("ghost-2")).toBe(false);
    expect(host.isUnread("ghost-2")).toBe(true); // 归属锚末内容帧(I3):重载后无 tab 照标蓝
    await host.removeSession("ghost-2");
  });

  it("readopt 重锚未命中:空闲会话保持未锚定,后续噪音不开轮", async () => {
    sessions.push({ id: "ghost-3", profileId: PROFILE_ID, cwd: CWD } as SessionMeta);
    logBackends.set("ghost-3", IDLE_LINE + IDLE_LINE);
    await host.readoptSessions();
    expect(host.isTurnActive("ghost-3")).toBe(false);
    ptyOutputCbs.get("ghost-3")!("hook: background done");
    expect(host.isTurnActive("ghost-3")).toBe(false);
    await host.removeSession("ghost-3");
  });

  it("readopt 重锚纪律:profile 未声明 echoMarks,磁盘尾含回显行也不锚(未声明 = 行为不变)", async () => {
    const NOECHO_ID = "mirror-noecho-cli";
    if (!host.getCliProfile(NOECHO_ID)) {
      host.registerCliProfile({ id: NOECHO_ID, name: "noecho", command: "true", args: [], triggers: [] });
    }
    sessions.push({ id: "ghost-4", profileId: NOECHO_ID, cwd: CWD } as SessionMeta);
    logBackends.set("ghost-4", IDLE_LINE + ECHO_LINE + IDLE_LINE);
    await host.readoptSessions();
    expect(host.isTurnActive("ghost-4")).toBe(false);
    await host.removeSession("ghost-4");
  });
});
