/**
 * sessionStartFail 契约(启动失败摘要与守望):
 * crashTail —— 幕布尾部 → 可读摘要:取尾部 2000 字符为源;剥 ANSI
 *   (CSI 参数序列 / OSC 标题与超链 / 单字符转义);\r 重绘折成独立行;
 *   丢 JS 栈帧行(at … 开头);连续空行折叠 + 首尾 trim;非空输出超长钳 600;
 *   空输出回固定文案「进程退出且无任何输出」。
 * emitSessionStartFailed —— 仅当「启动窗口内退出」(now - adoptedAt ≤ 窗口,
 *   边界含)且会话仍在册时,摘 outputTail(sid, 2000) 经 crashTail 后以
 *   KernelTopics.sessionStartFailed 广播 {sessionId, profileId, reason};
 *   超窗或会话已移除 = 静默不 emit、不读幕布。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus, KernelTopics } from "./events";
import {
  crashTail,
  emitSessionStartFailed,
  TAIL_SOURCE_CHARS,
} from "./sessionStartFail";

const ANSI = {
  csi: "\x1b[2J\x1b[1;31m",
  oscBel: "\x1b]0;my-app\x07",
  oscSt: "\x1b]8;;http://x\x1b\\",
  bare: "\x1bM",
};

function makeHost(tail: string, ids: string[] = ["s1"]) {
  return {
    getSessions: vi.fn(() => ids.map((id) => ({ id }))),
    outputTail: vi.fn(() => tail),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-19T00:00:00Z"));
});

describe("crashTail", () => {
  it("剥 ANSI 序列(CSI/OSC-bel/OSC-ST/单字符转义),正文保留", () => {
    const raw = [
      ANSI.csi,
      `${ANSI.oscBel}Error: boom${ANSI.oscSt}`,
      `${ANSI.bare}exit code 1`,
    ].join("\n");
    expect(crashTail(raw)).toBe("Error: boom\nexit code 1");
  });

  it("\\r 重绘折成独立行、丢 at 栈帧行、连续空行折叠、首尾 trim", () => {
    const raw = [
      "\x1b[31mError: boom\x1b[0m",
      "    at foo (/x/y.js:1:2)",
      "\tat bar (/x/z.js:3:4)",
      "",
      "",
      "exit code 1",
    ].join("\r\n");
    const loading = "Loading...\r";
    expect(crashTail(loading + raw)).toBe(
      "Loading...\nError: boom\nexit code 1",
    );
  });

  it("空输出(空白串)回固定文案", () => {
    expect(crashTail("")).toBe("进程退出且无任何输出");
    expect(crashTail("  \r\n \x1b[0m ")).toBe("进程退出且无任何输出");
  });

  it("只取幕布尾部 2000 字符:头部内容丢弃、尾部内容保留", () => {
    const head = "HEAD-MARKER";
    const filler = "a".repeat(TAIL_SOURCE_CHARS);
    const tail = "TAIL-MARKER";
    const out = crashTail([head, filler, tail].join("\n"));
    expect(out).not.toContain(head);
    expect(out.endsWith(tail)).toBe(true);
  });

  it("非空输出超长钳到 600 字符", () => {
    expect(crashTail("x".repeat(700))).toHaveLength(600);
  });
});

describe("emitSessionStartFailed", () => {
  it("窗口内 + 会话在册:广播 sessionStartFailed,reason 摘自幕布尾部", () => {
    const now = Date.now();
    const host = makeHost("\x1b[31mError: boom\x1b[0m\nexit code 1");
    const events = new EventBus();
    const received: unknown[] = [];
    events.on(KernelTopics.sessionStartFailed, (p) => received.push(p));

    emitSessionStartFailed(host, events, "s1", "p-claude", now - 1_000);

    expect(received).toEqual([
      { sessionId: "s1", profileId: "p-claude", reason: "Error: boom\nexit code 1" },
    ]);
    expect(host.outputTail).toHaveBeenCalledWith("s1", TAIL_SOURCE_CHARS);
  });

  it("窗口边界:退出时刻距今恰为窗口宽仍算启动失败;超出 1ms 即静默", () => {
    const now = Date.now();
    const events = new EventBus();
    const received: unknown[] = [];
    events.on(KernelTopics.sessionStartFailed, (p) => received.push(p));

    emitSessionStartFailed(makeHost("boom"), events, "s1", "p", now - 20_000);
    expect(received).toHaveLength(1);

    emitSessionStartFailed(makeHost("boom"), events, "s1", "p", now - 20_001);
    expect(received).toHaveLength(1);
  });

  it("超窗或会话已移除:静默不 emit、不读幕布", () => {
    const now = Date.now();
    const late = makeHost("boom");
    emitSessionStartFailed(late, new EventBus(), "s1", "p", now - 20_001);
    const gone = makeHost("boom", []);
    emitSessionStartFailed(gone, new EventBus(), "s1", "p", now - 1_000);

    expect(late.outputTail).not.toHaveBeenCalled();
    expect(gone.outputTail).not.toHaveBeenCalled();
    expect(gone.getSessions).toHaveBeenCalled();
  });
});
