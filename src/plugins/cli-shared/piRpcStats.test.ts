/**
 * PiRpcSession 用量/命令目录单测(get_session_stats / get_available_commands)。
 * 从 piRpc.test.ts 拆出:主测试文件恒满 300,mock 同形复制(piRpc.test 同源)。
 * 各 describe 自带 beforeEach 清 writes/listeners —— 跨 describe 陈旧监听器会
 * 吞掉 frame 应答,boot 假通过后握手挂死(5000ms 超时即此因,2026-10-04 实证)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const writes: string[] = [];
const listeners = new Map<string, (payload: unknown) => void>();

vi.mock("@kernel/ipc", () => ({
  ipc: {
    procStreamSpawn: vi.fn(async () => "p-1"),
    procStreamWrite: vi.fn(async (_id: string, data: string) => {
      writes.push(data);
    }),
    procStreamKill: vi.fn(async () => undefined),
    onProcStream: vi.fn(async (_id: string, kind: string, cb: (p: unknown) => void) => {
      listeners.set(kind, cb);
      return () => listeners.delete(kind);
    }),
  },
}));

import { PiRpcSession } from "./piRpc";

function frame(obj: unknown): void {
  listeners.get("out")?.(JSON.stringify(obj));
}

async function boot(): Promise<PiRpcSession> {
  const s = new PiRpcSession({ command: "omp" }, "/ws", {
    onBlocks: () => undefined,
    onBusy: () => undefined,
    onConfirm: () => undefined,
    onExit: () => undefined,
    onError: () => undefined,
  });
  const started = s.start();
  await vi.waitUntil(() => writes.some((w) => w.includes("get_state")));
  frame({ type: "response", id: "tmd-1", success: true, data: { sessionId: "s1" } });
  await started;
  return s;
}

describe("用量与命令目录(18.6 实证形状)", () => {
  beforeEach(() => {
    writes.length = 0;
    listeners.clear();
  });

  it("getStats 提取 tokens.total 与 contextUsage.percent,缺失字段容错为 undefined", async () => {
    const s = await boot();
    const req = s.getStats();
    await vi.waitUntil(() => writes.some((w) => w.includes("get_session_stats")));
    frame({ type: "response", id: "tmd-2", success: true, data: { tokens: { total: 20795 }, contextUsage: { percent: 2.0792 } } });
    expect(await req).toEqual({ totalTokens: 20795, contextPercent: 2.0792 });
    s.kill();
  });

  it("getCommands 过滤无 name 行并映射 input.hint;非数组回空表(不开补全)", async () => {
    const s = await boot();
    const req = s.getCommands();
    await vi.waitUntil(() => writes.some((w) => w.includes("get_available_commands")));
    frame({ type: "response", id: "tmd-2", success: true, data: { commands: [{ name: "security", description: "scans", input: { hint: "<plan>" } }, { nope: 1 }] } });
    expect(await req).toEqual([{ name: "security", description: "scans", hint: "<plan>" }]);
    s.kill();
  });

  it("stats/commands 失败(异常应答)回空态:stats=null、commands=[]", async () => {
    const s = await boot();
    const st = s.getStats();
    await vi.waitUntil(() => writes.some((w) => w.includes("get_session_stats")));
    frame({ type: "response", id: "tmd-2", success: false, error: "boom" });
    expect(await st).toBeNull();
    const cq = s.getCommands();
    await vi.waitUntil(() => writes.some((w) => w.includes("get_available_commands")));
    frame({ type: "response", id: "tmd-3", success: false, error: "boom" });
    expect(await cq).toEqual([]);
    s.kill();
  });
});
