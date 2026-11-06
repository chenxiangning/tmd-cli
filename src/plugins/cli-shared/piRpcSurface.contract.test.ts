/** liveSurface 流式活跃面 + follow_up 用户回显契约(2026-11-05 幕布流缺陷
 *  收口:渲染层按 surface 给活思考/正文展开态,不再按 is-last —— rebuild 布局
 *  中活思考永远排在轮级工具行之前,位置判据让轮内第二段起的思考永不展开)。
 *  follow_up 路:omp 不发 user 消息帧,ack 后排队本地回显,下一轮回界帧注入
 *  轮首(立刻注入会落进尚在途的上一轮切片)。mock  setup 同 piRpc.test.ts。
 */
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

import { PiRpcSession, type PiLiveSurface } from "./piRpc";
import type { CliTranscriptBlock } from "@kernel/cli";

function frame(obj: unknown): void {
  listeners.get("out")?.(JSON.stringify(obj));
}

type Seen = { blocks: CliTranscriptBlock[]; ts: number; surface: PiLiveSurface };

function bootSession(seen: Seen[]): PiRpcSession {
  return new PiRpcSession({ command: "omp" }, "/ws", {
    onBlocks: (b, ts, surface) => { seen.push({ blocks: b, ts, surface }); },
    onBusy: () => undefined,
    onConfirm: () => undefined,
    onExit: () => undefined,
    onError: () => undefined,
  });
}

/** 完成 get_state 握手(每个用例各自 boot 后调用)。 */
async function handshake(): Promise<void> {
  await vi.waitUntil(() => writes.some((w) => w.includes("get_state")));
  frame({ type: "response", id: "tmd-1", success: true, data: { sessionId: "s1" } });
}

describe("liveSurface 流式活跃面", () => {
  beforeEach(() => {
    listeners.clear();
    writes.length = 0;
  });

  it("thinking_delta → surface=thinking;text_delta → text;消息结算即清", async () => {
    const seen: Seen[] = [];
    const s = bootSession(seen);
    const started = s.start();
    await handshake();
    await started;
    frame({ type: "turn_start" });
    frame({ type: "message_start", message: { role: "assistant", content: [] } });
    frame({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "想" } });
    expect(seen.at(-1)?.surface).toBe("thinking");
    frame({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "答" } });
    expect(seen.at(-1)?.surface).toBe("text");
    frame({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "答" }] } });
    expect(seen.at(-1)?.surface).toBeNull();
    s.kill();
  });

  it("工具执行间隙(无活消息)surface 保持 null —— 思考/正文均不展开", async () => {
    const seen: Seen[] = [];
    const s = bootSession(seen);
    const started = s.start();
    await handshake();
    await started;
    frame({ type: "turn_start" });
    frame({ type: "message_start", message: { role: "assistant", content: [] } });
    frame({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "想" } });
    frame({ type: "message_end", message: { role: "assistant", content: [] } });
    frame({ type: "tool_execution_start", toolCallId: "k1", toolName: "Bash" });
    expect(seen.at(-1)?.surface).toBeNull();
    s.kill();
  });
});

describe("follow_up 用户消息本地回显", () => {
  beforeEach(() => {
    listeners.clear();
    writes.length = 0;
  });

  it("ack 后排队,下一轮回界帧注入轮首(下标 = 新 turnStart)", async () => {
    const seen: Seen[] = [];
    const s = new PiRpcSession({ command: "omp" }, "/ws", {
      onBlocks: (b, ts, surface) => { seen.push({ blocks: b, ts, surface }); },
      onBusy: () => undefined,
      onConfirm: () => undefined,
      onExit: () => undefined,
      onError: () => undefined,
    });
    const started = s.start();
    await vi.waitUntil(() => writes.some((w) => w.includes("get_state")));
    frame({ type: "response", id: "tmd-1", success: true, data: { sessionId: "s1" } });
    await started;
    /* busy 期 follow_up:ack 即时,但上轮未结算 —— 此刻不得注入。 */
    const w0 = writes.length;
    const fu = s.followUp("重新做一轮分析");
    await vi.waitUntil(() => writes.slice(w0).some((w) => w.includes("follow_up")));
    const fuWrite = writes.slice(w0).find((w) => w.includes("follow_up"))!;
    const fuId = (JSON.parse(fuWrite) as { id: string }).id;
    frame({ type: "response", id: fuId, success: true, data: {} });
    await fu;
    /* ack 后尚无块帧(回显只在下轮回界帧注入):不得提前出现用户文本。 */
    expect(seen.length).toBe(0);
    /* 下一轮 turn_start:回显块下标恰 = 新轮界 → 归活轮(与首轮 user 占位同位)。 */
    frame({ type: "session_settled" });
    frame({ type: "turn_start" });
    const at = seen.at(-1)!;
    expect(at.blocks[at.ts]).toMatchObject({ role: "user", text: "重新做一轮分析" });
    expect(at.ts).toBe(at.blocks.length - 1);
    s.kill();
  });
});

describe("queue_update 队列帧透传(B2-6 排队锚判据)", () => {
  beforeEach(() => {
    listeners.clear();
    writes.length = 0;
  });

  it("onLine 转发 queue_update 原帧到 onQueueUpdate;转录与 busy 不受扰", async () => {
    const seen: Record<string, unknown>[] = [];
    const s = new PiRpcSession({ command: "omp" }, "/ws", {
      onBlocks: () => undefined, onBusy: () => undefined, onConfirm: () => undefined,
      onExit: () => undefined, onError: () => undefined,
      onQueueUpdate: (rec) => { seen.push(rec); },
    });
    const started = s.start();
    await handshake();
    await started;
    frame({ type: "queue_update", steering: [], followUp: ["排队任务"] });
    frame({ type: "queue_update", steering: [], followUp: [] });
    expect(seen).toEqual([
      { type: "queue_update", steering: [], followUp: ["排队任务"] },
      { type: "queue_update", steering: [], followUp: [] },
    ]);
    s.kill();
  });
});
