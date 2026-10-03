/** 部件帧/confirm 的 id 契约(自 piRpc.test.ts 拆出,300 行铁则):
 *  - 数值 id 归一(normWidgetFrameId):不再被字符串守卫静默丢弃挂轮;
 *  - 数值 id 同型回传:JSON-RPC 应答 id 与请求同型,数值引擎严格匹配才认领
 *    (confirm 审批路 2026-10-03 二轮复查:字符串化 = 审批静默丢失挂死轮次);
 *  - 畸形帧(缺 id / null id)不产应答。 */
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

describe("部件帧 id 归一(数值型宽容)", () => {
  beforeEach(() => {
    writes.length = 0;
    listeners.clear();
  });

  it("数值 id 的真交互部件帧:归一后照答 cancelled 并逐条 notice,不再静默丢弃挂轮", async () => {
    const notices: string[] = [];
    const s = new PiRpcSession({ command: "omp" }, "/ws", {
      onBlocks: (next) => {
        for (const b of next) if (b.role === "system" && !notices.includes(b.text)) notices.push(b.text);
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
    frame({ type: "extension_ui_request", method: "select", id: 42 });
    /* 数值 id 同型回传(JSON-RPC 应答 id 与请求同型,2026-10-03 二轮评审) */
    await vi.waitUntil(() => writes.some((w) => w.includes('"id":42')));
    expect(writes.some((w) => w.includes('"id":42') && w.includes('"cancelled":true'))).toBe(true);
    expect(notices.some((x) => x.includes("CLI 发起 select 交互"))).toBe(true);
    s.kill();
  });

  it("数值 id × chrome 装饰类:同型应答 + 聚合降噪(归一与分档共享路径的组合角)", async () => {
    let blocks: { role: string; text: string }[] = [];
    const s = new PiRpcSession({ command: "omp" }, "/ws", {
      onBlocks: (next) => {
        blocks = next.map((b) => ({ role: b.role, text: b.text }));
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
    frame({ type: "extension_ui_request", method: "setStatus", id: 7 });
    await vi.waitUntil(() => writes.some((w) => w.includes('"id":7')));
    expect(writes.some((w) => w.includes('"id":7') && w.includes('"cancelled":true'))).toBe(true);
    expect(blocks.filter((b) => b.role === "system")).toHaveLength(1); // 聚合一行,不逐条
    expect(blocks[blocks.length - 1].text).toContain("×1(setStatus");
    s.kill();
  });

  it("缺 id / null id 的畸形帧:仍不产应答", async () => {
    const s = await boot();
    const wCount = writes.length;
    frame({ type: "extension_ui_request", method: "select" });
    frame({ type: "extension_ui_request", method: "select", id: null });
    expect(writes.length).toBe(wCount);
    s.kill();
  });

  it("confirm 数值 id 同型回传:批准应答 id 保持数字,引擎同型匹配可认领(2026-10-03 二轮复查)", async () => {
    /* 经持有者对象绕开 TS 对闭包赋值的 null 收窄(vi.waitUntil 不会拓宽 let)。 */
    const seen: { frameId?: string | number } = {};
    const s = new PiRpcSession({ command: "omp" }, "/ws", {
      onBlocks: () => undefined,
      onBusy: () => undefined,
      onConfirm: (req) => { seen.frameId = req.frameId; },
      onExit: () => undefined,
      onError: () => undefined,
    });
    const started = s.start();
    await vi.waitUntil(() => writes.some((w) => w.includes("get_state")));
    frame({ type: "response", id: "tmd-1", success: true, data: {} });
    await started;
    frame({ type: "extension_ui_request", method: "confirm", id: 42, title: "t", message: "m" });
    await vi.waitUntil(() => seen.frameId !== undefined);
    expect(seen.frameId).toBe(42); /* 原始类型保真,不再 String() 字符串化 */
    writes.length = 0;
    s.respond(seen.frameId!, true);
    await vi.waitUntil(() => writes.length > 0);
    expect(writes[0]).toContain('"id":42');
    expect(writes[0]).toContain('"confirmed":true');
    s.kill();
  });
});
