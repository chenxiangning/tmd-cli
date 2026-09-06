/**
 * 秒退守望(sessionStartFailed)回归测试。
 *
 * 实证缺陷:omp 因插件注册保留 API 名启动即崩,pty://exit 触发 removeSession
 * 秒删 tab + 清输出缓冲,报错在任何界面都来不及呈现,症状是"新建会话直接回退首页"。
 * 契约(kernel/sessionSpawn.ts):
 * - spawn 后 20s 窗口内退出 = 启动失败,广播幕布尾部剥 ANSI 摘要;
 * - 窗口外退出 = 正常退出,不广播;
 * - spawn 即被拒(命令不存在等)= 幕布尚不存在,广播错误消息后原样抛出。
 *
 * host 是全局单例;本文件自建 ipc mock(exit 回调须捕获,与 host.test.ts 的输出捕获同理)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "./ipc";

let spawnSeq = 0;
const sessions: SessionMeta[] = [];
const ptyOutputCbs = new Map<string, (text: string) => void>();
const ptyExitCbs = new Map<string, () => void>();
/** 可控 spawn 失败:模拟命令不存在/IPC 错。 */
let spawnError: Error | null = null;

vi.mock("./ipc", () => ({
  ipc: {
    sessionSpawn: vi.fn(async (profileId: string, spec: { cwd: string }) => {
      if (spawnError) throw spawnError;
      spawnSeq += 1;
      const id = `pty-${spawnSeq}`;
      sessions.push({ id, profileId, cwd: spec.cwd } as SessionMeta);
      return { id, pid: 3000 + spawnSeq };
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
  onPtyExit: vi.fn(async (id: string, cb: () => void) => {
    ptyExitCbs.set(id, cb);
    return () => undefined;
  }),
}));

import { host } from "./host";
import { crashTail } from "./sessionSpawn";
import { KernelTopics, type SessionStartFailedEvent } from "./events";

const PROFILE_ID = "test-omp";

const profile = {
  id: PROFILE_ID,
  name: "test",
  command: "true",
  args: [],
  triggers: [],
};

describe("秒退守望 sessionStartFailed", () => {
  let got: SessionStartFailedEvent[];
  let off: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    sessions.length = 0;
    ptyOutputCbs.clear();
    ptyExitCbs.clear();
    spawnError = null;
    if (!host.getCliProfile(PROFILE_ID)) host.registerCliProfile(profile);
    got = [];
    off = host.events.on<SessionStartFailedEvent>(
      KernelTopics.sessionStartFailed,
      (e) => got.push(e),
    );
  });

  afterEach(() => {
    off();
    vi.useRealTimers();
  });

  it("启动窗口内秒退:广播幕布尾部剥 ANSI 摘要,profileId 随事件带出", async () => {
    const a = await host.createSession(PROFILE_ID, "/proj");
    ptyOutputCbs.get(a.id)?.(
      "\x1b[31mConfigurationError: Cannot register custom API\x1b[0m\n    at _ho (cli.js:181)\n",
    );
    await vi.advanceTimersByTimeAsync(2_000);
    ptyExitCbs.get(a.id)?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(got).toHaveLength(1);
    expect(got[0].sessionId).toBe(a.id);
    expect(got[0].profileId).toBe(PROFILE_ID);
    expect(got[0].reason).toContain("ConfigurationError: Cannot register custom API");
    expect(got[0].reason).not.toContain("\x1b");
    expect(got[0].reason).not.toContain("at _ho");
  });

  it("启动窗口外退出:视为正常退出,不广播", async () => {
    const a = await host.createSession(PROFILE_ID, "/proj");
    ptyOutputCbs.get(a.id)?.("bye");
    await vi.advanceTimersByTimeAsync(21_000);
    ptyExitCbs.get(a.id)?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(got).toHaveLength(0);
  });

  it("spawn 即被拒:广播错误消息(sessionId 为 null)且原样抛出", async () => {
    spawnError = new Error("spawn enoent");
    await expect(host.createSession(PROFILE_ID, "/proj")).rejects.toThrow("spawn enoent");

    expect(got).toHaveLength(1);
    expect(got[0].sessionId).toBeNull();
    expect(got[0].profileId).toBe(PROFILE_ID);
    expect(got[0].reason).toBe("spawn enoent");
  });
});

describe("crashTail 幕布尾部压缩", () => {
  it("剥 ANSI 样式序列、折叠 \\r 重绘、丢栈帧行、压空行", () => {
    const raw =
      "\x1b[?25l\x1b[2J\x1b[1;1Hloading...\r\n\r\n\r\n\x1b[31mBoom: reserved name\x1b[0m\r\n" +
      "    at _ho (cli.js:181:4055)\r\n    at U6e (cli.js:181:4158)\r\n";
    const out = crashTail(raw);
    expect(out).toBe("loading...\nBoom: reserved name");
  });

  it("无输出(缓冲被清/静默崩溃)给固定文案", () => {
    expect(crashTail("")).toBe("进程退出且无任何输出");
  });
});
