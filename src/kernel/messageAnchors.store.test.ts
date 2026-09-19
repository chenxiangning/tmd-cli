/**
 * MessageAnchorStore 轮询契约(host 接线同款 ipc mock):
 * - 单拍读取悬挂 → 超时弃拍(inFlight 不再被永久占死),下一拍重试自愈;
 * - 正常读取按 id 增量合并,快照引用稳定。
 * 背景(2026-09-19 实证):时间线全灭排查中,绑定/解析/展示逐层验证均通,
 * 唯一能全灭 store 的路径 = 首拍 IPC 悬挂把共享 inFlight 卡死 —— 本文件锁住
 * 「悬挂不再永久卡死」这一行为。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliUserMessage } from "./cli";
import type { SessionMeta } from "./ipc";

vi.mock("./ipc", () => ({
  ipc: {
    sessionList: vi.fn(async () => [] as SessionMeta[]),
    sessionDiskLogBind: vi.fn(async () => undefined),
  },
  onPtyOutput: vi.fn(async () => () => undefined),
  onPtyExit: vi.fn(async () => () => undefined),
}));

import { host } from "./host";
import { messageAnchors } from "./messageAnchors";

const POLL_MS = 2_000;
const READ_TIMEOUT_MS = 10_000;
const MSG: CliUserMessage = { id: "m1", text: "你好" };

/* Host 无公开 sessions 写口(测试注入唯一途径):具名收窄一次,集中于此 */
const hostInternals = host as unknown as { sessions: unknown[] };

/* profile 只注册一次(注册表禁止重复),reader 实现按用例替换 */
let readerImpl: () => Promise<CliUserMessage[] | null> = () => Promise.resolve([]);
host.registerCliProfile({
  id: "hang-cli",
  name: "hang",
  command: "true",
  args: [],
  triggers: [],
  readSessionUserMessages: (...a: Parameters<typeof readerImpl>) => readerImpl(...a),
});

describe("MessageAnchorStore 轮询", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    /* node 环境 window 由本测试供给;箭头闭包延迟解析,换取假定时器生效 */
    vi.stubGlobal("window", {
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
      clearInterval: (t: ReturnType<typeof setInterval>) => clearInterval(t),
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function registerReader(reader: () => Promise<CliUserMessage[] | null>): void {
    readerImpl = reader;
    hostInternals.sessions = [
      { id: "s1", profileId: "hang-cli", cwd: "/w", kind: "cli" },
    ];
    host.setActiveSession("s1");
    host.bindIdentityForTest("s1", "cli-f1");
  }

  it("悬挂读取超时弃拍,下一拍自愈", async () => {
    let calls = 0;
    registerReader(() => {
      calls += 1;
      return calls === 1 ? new Promise<never>(() => {}) : Promise.resolve([MSG]);
    });
    const unsub = messageAnchors.subscribe(() => {});

    await vi.advanceTimersByTimeAsync(0); // 首拍立即发出 → 悬挂中
    expect(calls).toBe(1);
    expect(messageAnchors.getAnchors("s1")).toHaveLength(0);

    /* 超时弃拍 + 重试拍(同刻定时器触发次序不作断言,只锁行为:悬挂不卡死、
       后续拍成功并入) */
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS + 2 * POLL_MS);
    expect(calls).toBeGreaterThan(1);
    expect(messageAnchors.getAnchors("s1")).toHaveLength(1);
    unsub();
  });

  it("正常读取增量合并,快照引用稳定", async () => {
    registerReader(() => Promise.resolve([MSG]));
    const unsub = messageAnchors.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const first = messageAnchors.getAnchors("s1");
    expect(first).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(POLL_MS); // 同批无新 id:不换数组
    expect(messageAnchors.getAnchors("s1")).toBe(first);
    unsub();
  });
});
