/** 结算帧双名分发回归(pi 1.4.0 agent_settled,2026-11-06 本机抓包实证;
 *  piRpc.test.ts 300 行铁则拆分先例见 piRpcIds.test.ts)。翻车点 = piRpc
 *  onLine 分发层帧名失配(只认 omp 18.x 的 session_settled → busy 卡死),
 *  reducer 等价测试拦不住分发层回归,故直钉 onBusy 序列。 */
import { describe, expect, it, vi } from "vitest";

const listeners = new Map<string, (p: unknown) => void>();
const writes: string[] = [];

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

describe("结算帧双名分发(pi 1.4.0)", () => {
  it("agent_start → agent_settled 触发 onBusy [true,false];session_settled 同路", async () => {
    const busySeq: string[] = [];
    const s = new PiRpcSession({ command: "pi" }, "/ws", {
      onBlocks: () => undefined,
      onBusy: (b) => busySeq.push(b ? "up" : "down"),
      onConfirm: () => undefined,
      onExit: () => undefined,
      onError: () => undefined,
    });
    const started = s.start();
    await vi.waitUntil(() => writes.some((w) => w.includes("get_state")));
    frame({ type: "response", id: "tmd-1", success: true, data: { sessionId: "s1" } });
    await started;
    frame({ type: "agent_start" });
    frame({ type: "turn_start" });
    frame({ type: "agent_settled" });
    expect(busySeq).toEqual(["up", "down"]);
    s.kill();
  });
});
