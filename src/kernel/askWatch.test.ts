/**
 * AskWatch v2 行为契约测试(候选确认制 + 结算自愈)。
 *
 * 覆盖:候选确认窗(首击立候选不置位 → 复现且距首击 ≥1.2s 才升级)、
 * 瞬态内容撤销(作答残影不复燃 / resume 回放历史面板不错绑 —— 两个实测 bug 的
 * 回归测试,字节序列取自 ~/.tmd-cli session 日志的 omp 真实帧序)、等待中边沿
 * 去重、静默自愈(尾巴无字面量摘除残签 / 真面板保守保留)、用户作答清除 +
 * 尾巴重置、会话移除清理;以及 host 接线(appendOutput 检测 → isWaitingConfirm /
 * askDetected 事件,writeSession 作答清除,静默自愈,removeSession 清理)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "./ipc";
import { AskWatch, stripAnsi } from "./askWatch";

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

describe("AskWatch 标记检测与状态迁移(候选确认制)", () => {
  let watch: AskWatch;

  beforeEach(() => {
    vi.useFakeTimers();
    watch = new AskWatch();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("omp Ask 面板:首击只立候选不置位,复现且过确认窗才升级", async () => {
    expect(watch.onOutput("s1", OMP_ASK)).toBe(false);
    expect(watch.isWaiting("s1")).toBe(false);
    await pastConfirm();
    expect(watch.onOutput("s1", OMP_ASK)).toBe(true);
    expect(watch.isWaiting("s1")).toBe(true);
  });

  it("确认窗内的复现(距首击 <1.2s)不升级,满窗后那次才升级", async () => {
    watch.onOutput("s2", OMP_ASK);
    await vi.advanceTimersByTimeAsync(500);
    expect(watch.onOutput("s2", OMP_ASK)).toBe(false);
    expect(watch.isWaiting("s2")).toBe(false);
    await vi.advanceTimersByTimeAsync(900); // 距首击已 1.4s
    expect(watch.onOutput("s2", OMP_ASK)).toBe(true);
  });

  it("瞬态内容:标记滚出页脚窗口即撤销候选(作答残影不复燃)", async () => {
    watch.onOutput("s3", OMP_ASK); // 面板帧
    /* 响应流多行推进,把面板标记冲出末 5 行窗口 */
    watch.onOutput("s3", "assistant response streams on\r\nline2\r\nline3\r\nline4\r\nline5\r\n");
    await pastConfirm();
    expect(watch.onOutput("s3", "more response\r\n")).toBe(false);
    expect(watch.isWaiting("s3")).toBe(false);
  });

  it("resume 回放的历史面板文本是瞬态:流式滚过不错绑(bug 2 回归)", async () => {
    /* 切换会话 → 回放整段 transcript,历史面板夹在正文中间一闪而过 */
    const replay = [
      "╭─ transcript ───╮",
      OMP_ASK,
      "user answered long ago",
      "loads of transcript lines follow",
      "╰─ end ───╯",
    ].join("\r\n");
    expect(watch.onOutput("s4", replay)).toBe(false);
    await pastConfirm();
    expect(watch.onOutput("s4", "replay continues\r\n")).toBe(false);
    expect(watch.isWaiting("s4")).toBe(false);
  });

  it("claude 确认页脚 / 通用 y-n / Do you want 句式同样走候选确认", async () => {
    expect(watch.onOutput("s5", "╭──────────╮\n Esc to cancel")).toBe(false);
    await pastConfirm();
    expect(watch.onOutput("s5", " Esc to cancel")).toBe(true);
    expect(watch.onOutput("s6", "Proceed with revert? (y/n)")).toBe(false);
    await pastConfirm();
    expect(watch.onOutput("s6", "(y/n)")).toBe(true);
    expect(watch.onOutput("s7", "Do you want to make this edit?")).toBe(false);
    await pastConfirm();
    expect(watch.onOutput("s7", "Do you want to proceed?")).toBe(true);
  });

  it("普通输出不误报", () => {
    expect(watch.onOutput("s8", "ESC to exit. Press Enter to continue.")).toBe(false);
    expect(watch.onOutput("s8", "task completed in 2 questions of 10")).toBe(false);
    expect(watch.isWaiting("s8")).toBe(false);
  });

  it("标记被 PTY 分片劈开仍可确认(中间夹 ANSI)", async () => {
    expect(watch.onOutput("s9", "\x1b[33mChoose: Esc to can")).toBe(false); // 半截不命中
    expect(watch.onOutput("s9", "\x1b[0mcel")).toBe(false); // 拼齐命中 → 立候选
    await pastConfirm();
    expect(watch.onOutput("s9", "redraw still shows: Esc to cancel")).toBe(true);
  });

  it("页脚窗口:标记滚出末 5 行不命中(正文引用不触发)", () => {
    const scrolledOut = "Ask 1 questions\npad1\npad2\npad3\npad4\npad5";
    expect(watch.onOutput("s10", scrolledOut)).toBe(false);
  });

  it("等待中的重绘不重复触发(边沿去重)", async () => {
    watch.onOutput("s11", OMP_ASK);
    await pastConfirm();
    watch.onOutput("s11", OMP_ASK);
    expect(watch.onOutput("s11", OMP_ASK)).toBe(false);
    expect(watch.isWaiting("s11")).toBe(true);
  });

  it("用户作答清除;作答后的整帧重绘(残影)不再复燃(bug 1 回归)", async () => {
    watch.onOutput("s12", OMP_ASK);
    await pastConfirm();
    watch.onOutput("s12", OMP_ASK); // 确认升级
    expect(watch.onUserWrite("s12")).toBe(true);
    expect(watch.isWaiting("s12")).toBe(false);
    /* 实测序列:作答后 omp 整帧重发面板文本(旧模型在此复燃并卡死整个响应流) */
    expect(watch.onOutput("s12", OMP_ASK)).toBe(false);
    expect(watch.onOutput("s12", "response\r\n")).toBe(false);
    expect(watch.isWaiting("s12")).toBe(false);
  });

  it("作答后的下一个提问仍会进入等待(连续多问流程)", async () => {
    watch.onOutput("s13", OMP_ASK);
    await pastConfirm();
    watch.onOutput("s13", OMP_ASK);
    watch.onUserWrite("s13");
    /* 下一问:候选 → 确认,与首问同径 */
    expect(watch.onOutput("s13", OMP_ASK)).toBe(false);
    await pastConfirm();
    expect(watch.onOutput("s13", OMP_ASK)).toBe(true);
  });

  it("静默自愈:等待中 CLI 自行继续(响应流过、尾巴无字面量)→ 摘除残签", async () => {
    watch.onOutput("s14", OMP_ASK);
    await pastConfirm();
    watch.onOutput("s14", OMP_ASK);
    expect(watch.isWaiting("s14")).toBe(true);
    watch.onOutput(
      "s14",
      "auto-continued\r\nfull response\r\nstreams many lines\r\npushing the panel out\r\nof the footer window\r\n",
    );
    /* 响应静默 2s 后守望摘签(1Hz 计时器) */
    await vi.advanceTimersByTimeAsync(3_500);
    expect(watch.isWaiting("s14")).toBe(false);
  });

  it("静默保护:尾巴仍有面板字面量(真面板静默挂起)不误清", async () => {
    watch.onOutput("s15", OMP_ASK);
    await pastConfirm();
    watch.onOutput("s15", OMP_ASK);
    watch.onOutput("s15", "last frame still shows the panel footer: Esc to cancel");
    await vi.advanceTimersByTimeAsync(3_500);
    expect(watch.isWaiting("s15")).toBe(true);
  });

  it("未在等待时写入是幂等空操作", () => {
    expect(watch.onUserWrite("s16")).toBe(false);
  });

  it("会话移除清等待;同 id 重建后从零检测", async () => {
    watch.onOutput("s17", OMP_ASK);
    await pastConfirm();
    watch.onOutput("s17", OMP_ASK);
    watch.onSessionRemoved("s17");
    expect(watch.isWaiting("s17")).toBe(false);
    watch.onOutput("s17", OMP_ASK);
    await pastConfirm();
    expect(watch.onOutput("s17", OMP_ASK)).toBe(true);
  });

  it("resetForTest 全态归零", async () => {
    watch.onOutput("s18", OMP_ASK);
    watch.resetForTest();
    await pastConfirm();
    expect(watch.onOutput("s18", OMP_ASK)).toBe(false);
    expect(watch.isWaiting("s18")).toBe(false);
  });

  it("stripAnsi 剥离转义序列(跨 chunk 截断后拼接复原)", () => {
    expect(stripAnsi("text\x1b" + "[31mred\x1b[0m")).toBe("textred");
  });
});

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
      });
    }
  });

  afterEach(() => {
    host.resetStatusTimerForTest();
    host.resetActivityWatchForTest();
    vi.useRealTimers();
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
