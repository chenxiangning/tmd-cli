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
import { PiRpcSession, widgetCancelledNotice } from "./piRpc";

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

describe("widgetCancelledNotice 非 confirm 部件判定", () => {
  const T0 = new Date(2026, 9, 1, 8, 9, 5);

  it("select 部件:回 frameId/kind + 带时刻的 notice 文案", () => {
    const n = widgetCancelledNotice({ type: "extension_ui_request", method: "select", id: "q1" }, T0);
    expect(n).toEqual({
      frameId: "q1",
      kind: "select",
      text: "CLI 发起 select 交互,已按协议自动取消(08:09:05)",
    });
  });

  it("confirm(审批回路)与非本类帧/畸形帧不产 notice", () => {
    expect(widgetCancelledNotice({ type: "extension_ui_request", method: "confirm", id: "q2" }, T0)).toBeNull();
    expect(widgetCancelledNotice({ type: "message_end" }, T0)).toBeNull();
    expect(widgetCancelledNotice({ type: "extension_ui_request", method: "input" }, T0)).toBeNull();
  });
});

describe("PiRpcSession 退出守卫", () => {
  beforeEach(() => {
    writes.length = 0;
    listeners.clear();
    vi.mocked(ipc.procStreamKill).mockClear();
  });

  it("活会话收到 input 部件:回 cancelled 且转录插可见 notice", async () => {
    const notices: string[] = [];
    const s = new PiRpcSession({ command: "omp" }, "/ws", {
      onBlocks: (blocks) => {
        const last = blocks[blocks.length - 1];
        if (last?.role === "system") notices.push(last.text);
      },
      onBusy: () => undefined,
      onConfirm: () => undefined,
      onExit: () => undefined,
      onError: () => undefined,
    });
    const started = s.start();
    await vi.waitUntil(() => writes.some((w) => w.includes("get_state")));
    frame({ type: "response", id: "tmd-1", success: true, data: {} });
    await started;
    frame({ type: "extension_ui_request", method: "input", id: "w1" });
    await vi.waitUntil(() => writes.some((w) => w.includes("extension_ui_response")));
    expect(writes.some((w) => w.includes('"id":"w1"') && w.includes('"cancelled":true'))).toBe(true);
    expect(notices.some((x) => x.includes("CLI 发起 input 交互,已按协议自动取消"))).toBe(true);
    s.kill();
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
