/** PiRpcSession 生命周期守卫回归:exited 置位后 respond/非 confirm 部件取消
 *  静默(此前 exited 永不置位 → 退出后应答 = procStreamWrite 对已清注册表报错 =
 *  unhandled rejection,由 vitest 运行级捕获钉死);pending 统一 reject;
 *  kill-after-exit 不再外发 IPC。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { ipc } from "@kernel/ipc";
import { PiRpcSession } from "./piRpc";

function frame(obj: unknown): void {
  listeners.get("out")?.(JSON.stringify(obj));
}

/** 握手完成(get_state 应答 tmd-1)后返回活会话。 */
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

describe("PiRpcSession 退出守卫", () => {
  beforeEach(() => {
    writes.length = 0;
    listeners.clear();
    vi.mocked(ipc.procStreamKill).mockClear();
  });

  it("退出后 respond 与非 confirm 部件取消静默,不再写 stdin", async () => {
    const s = await boot();
    listeners.get("exit")?.(0);
    const wCount = writes.length;
    s.respond("f1", true);
    frame({ type: "extension_ui_request", method: "select", id: "q1" });
    expect(writes.length).toBe(wCount);
  });

  it("退出时在途请求统一 reject(rpc 进程已退出)", async () => {
    const s = await boot();
    const sent = s.send("hello");
    listeners.get("exit")?.(null);
    await expect(sent).rejects.toThrow("rpc 进程已退出");
  });

  it("kill-after-exit 不再外发无效 IPC", async () => {
    const s = await boot();
    listeners.get("exit")?.(0);
    s.kill();
    expect(vi.mocked(ipc.procStreamKill)).not.toHaveBeenCalled();
  });
});
