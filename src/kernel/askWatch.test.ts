/**
 * AskWatch 行为契约测试。
 * 覆盖:标记命中(omp Ask/claude 页脚/y-n/Do you want)、ANSI 混杂、跨 chunk 劈开、
 * 页脚窗口收敛、等待中的边沿去重(重绘不重复触发)、用户作答清除 + 尾巴重置
 * (旧标记不得借回显复燃)、会话移除清理;以及 host 接线(appendOutput 检测 →
 * isWaitingConfirm / askDetected 事件,writeSession 作答清除,removeSession 清理)。
 * 否定断言(不置位)直接断 onOutput 返回 false,无需冲洗管线。
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

describe("AskWatch 标记检测与状态迁移", () => {
  let watch: AskWatch;

  beforeEach(() => {
    watch = new AskWatch();
  });

  it("omp Ask 面板命中:置位并报告边沿", () => {
    expect(watch.onOutput("s1", OMP_ASK)).toBe(true);
    expect(watch.isWaiting("s1")).toBe(true);
  });

  it("claude 确认页脚 / 通用 y-n / Do you want 句式命中", () => {
    expect(watch.onOutput("s2", "╭──────────╮\n Esc to cancel")).toBe(true);
    expect(watch.isWaiting("s2")).toBe(true);
    expect(watch.onOutput("s3", "Proceed with revert? (y/n)")).toBe(true);
    expect(watch.onOutput("s3b", "Proceed? [Y/N]")).toBe(true);
    expect(watch.onOutput("s4", "Do you want to make this edit?")).toBe(true);
  });

  it("普通输出不误报", () => {
    expect(watch.onOutput("s5", "ESC to exit. Press Enter to continue.")).toBe(false);
    expect(watch.onOutput("s5", "task completed in 2 questions of 10")).toBe(false);
    expect(watch.isWaiting("s5")).toBe(false);
  });

  it("标记被 PTY 分片劈开仍命中(中间夹 ANSI)", () => {
    expect(watch.onOutput("s6", "\x1b[33mChoose: Esc to can")).toBe(false);
    expect(watch.onOutput("s6", "\x1b[0mcel")).toBe(true);
  });

  it("页脚窗口:标记滚出末 5 行不命中(正文引用不触发)", () => {
    const scrolledOut = "Ask 1 questions\npad1\npad2\npad3\npad4\npad5";
    expect(watch.onOutput("s7", scrolledOut)).toBe(false);
  });

  it("等待中的重绘不重复触发(边沿去重,输出流不清等待)", () => {
    watch.onOutput("s8", OMP_ASK);
    expect(watch.onOutput("s8", OMP_ASK)).toBe(false);
    expect(watch.onOutput("s8", "spinner tick 1")).toBe(false);
    expect(watch.isWaiting("s8")).toBe(true);
  });

  it("用户作答清除;旧标记不得借写入回显的尾巴复燃", () => {
    watch.onOutput("s9", OMP_ASK);
    expect(watch.onUserWrite("s9")).toBe(true);
    expect(watch.isWaiting("s9")).toBe(false);
    /* 尾巴已随作答重置:短回显 chunk 拼不出旧标记 */
    expect(watch.onOutput("s9", "y\r\n")).toBe(false);
    expect(watch.onOutput("s9", OMP_ASK)).toBe(true);
  });

  it("未在等待时写入是幂等空操作", () => {
    expect(watch.onUserWrite("s10")).toBe(false);
  });

  it("会话移除清等待;同 id 重建后从零检测", () => {
    watch.onOutput("s11", OMP_ASK);
    watch.onSessionRemoved("s11");
    expect(watch.isWaiting("s11")).toBe(false);
    expect(watch.onOutput("s11", OMP_ASK)).toBe(true);
  });

  it("resetForTest 全态归零", () => {
    watch.onOutput("s12", OMP_ASK);
    watch.resetForTest();
    expect(watch.isWaiting("s12")).toBe(false);
  });

  it("stripAnsi 剥离转义序列(跨 chunk 截断后拼接复原)", () => {
    expect(stripAnsi("text\x1b" + "[31mred\x1b[0m")).toBe("textred");
  });
});

describe("host 接线:检测进主链路,状态对 UI 可读", () => {
  const PROFILE_ID = "ask-test-cli";
  const CWD = "/proj";

  beforeEach(() => {
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
  });

  it("提问标记 → askDetected 事件 + isWaitingConfirm;写入作答即清", async () => {
    const detected: string[] = [];
    const off = host.events.on<string>(KernelTopics.askDetected, (id) =>
      detected.push(id),
    );
    const s = await host.createSession(PROFILE_ID, CWD);
    ptyOutputCbs.get(s.id)!(OMP_ASK);
    expect(host.isWaitingConfirm(s.id)).toBe(true);
    expect(detected).toEqual([s.id]);
    /* 重绘不重复发事件 */
    ptyOutputCbs.get(s.id)!(OMP_ASK);
    expect(detected).toHaveLength(1);
    /* 任何写入 = 作答(选择/回车/快捷键统一走 writeSession) */
    host.writeSession(s.id, "\r");
    expect(host.isWaitingConfirm(s.id)).toBe(false);
    /* 下一个提问再次进入等待 */
    ptyOutputCbs.get(s.id)!(OMP_ASK);
    expect(host.isWaitingConfirm(s.id)).toBe(true);
    expect(detected).toHaveLength(2);
    off();
    await host.removeSession(s.id);
  });

  it("会话移除 → 等待残留一并清除", async () => {
    const s = await host.createSession(PROFILE_ID, CWD);
    ptyOutputCbs.get(s.id)!(OMP_ASK);
    expect(host.isWaitingConfirm(s.id)).toBe(true);
    await host.removeSession(s.id);
    expect(host.isWaitingConfirm(s.id)).toBe(false);
  });
});
