/** PiRpcSession 生命周期守卫回归:exited 置位后 respond/非 confirm 部件取消
 *  静默(此前 exited 永不置位 → 退出后应答 = procStreamWrite 对已清注册表报错 =
 *  unhandled rejection,由 vitest 运行级捕获钉死);pending 统一 reject;
 *  kill-after-exit 不再外发 IPC。
 *  部件帧 id 归一/同型回传族测试见 piRpcIds.test.ts(300 行铁则拆分)。 */
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
import { widgetCancelledNotice, widgetTier } from "./piRpcReducer";

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

describe("turn_start 轮界分发(18.6 更名)", () => {
  it("onLine 转发 turn_start → reducer 推进 turnStart(18.4 session_start 同路)", async () => {
    const seen: number[] = [];
    const s = new PiRpcSession({ command: "omp" }, "/ws", {
      onBlocks: (_b, ts) => { seen.push(ts); },
      onBusy: () => undefined,
      onConfirm: () => undefined,
      onExit: () => undefined,
      onError: () => undefined,
    });
    const started = s.start();
    await vi.waitUntil(() => writes.some((w) => w.includes("get_state")));
    frame({ type: "response", id: "tmd-1", success: true, data: { sessionId: "s1" } });
    await started;
    frame({ type: "message_start", message: { role: "user", content: [] } });
    frame({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "在吗" }] } });
    frame({ type: "turn_start" });
    expect(seen.at(-1)).toBe(1); // 用户块已落定,新轮界越过它
    frame({ type: "session_start" }); // 18.4 名仍兼容
    expect(seen.at(-1)).toBe(1);
    s.kill();
  });
});

describe("断线接续(resume 换壳)", () => {
  it("resume opts:spawn 带 resumeArgs;种子块随首帧回放,轮界对齐尾", async () => {
    const seen: Array<{ ts: number; texts: string[] }> = [];
    const s = new PiRpcSession(
      { command: "omp", resumeArgs: (id) => ["--resume", id] },
      "/ws",
      {
        onBlocks: (b, ts) => { seen.push({ ts, texts: b.map((x) => x.text ?? x.role) }); },
        onBusy: () => undefined,
        onConfirm: () => undefined,
        onExit: () => undefined,
        onError: () => undefined,
      },
      { resume: "sess-1", seedBlocks: [{ id: "x", role: "system", text: "旧转录" }] },
    );
    const w0 = writes.length;
    const started = s.start();
    await vi.waitUntil(() => writes.slice(w0).some((w) => w.includes("get_state")));
    frame({ type: "response", id: "tmd-1", success: true, data: { sessionId: "sess-1" } });
    await started;
    expect(ipc.procStreamSpawn).toHaveBeenLastCalledWith(expect.objectContaining({
      command: "omp",
      args: ["--mode", "rpc", "--resume", "sess-1"],
    }));
    frame({ type: "turn_start" });
    expect(seen.at(-1)?.texts).toEqual(["旧转录"]);
    expect(seen.at(-1)?.ts).toBe(1);
    s.kill();
  });
});

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

describe("widgetTier 部件分档", () => {
  it("chrome 装饰类 = setStatus/notify/setWidget;真交互与未知 kind 一律 interactive", () => {
    expect(widgetTier("setStatus")).toBe("chrome");
    expect(widgetTier("notify")).toBe("chrome");
    expect(widgetTier("setWidget")).toBe("chrome");
    expect(widgetTier("select")).toBe("interactive");
    expect(widgetTier("input")).toBe("interactive");
    expect(widgetTier("editor")).toBe("interactive");
    expect(widgetTier("future_kind")).toBe("interactive");
  });
});

describe("chrome 部件聚合降噪", () => {
  beforeEach(() => {
    writes.length = 0;
    listeners.clear();
  });

  it("chrome 五连取消并成一条聚合行(×N 明细原地刷新),被 select 隔开后新开一条", async () => {
    let blocks: { id: string; role: string; text: string }[] = [];
    const s = new PiRpcSession({ command: "omp" }, "/ws", {
      onBlocks: (next) => {
        blocks = next.map((b) => ({ id: b.id, role: b.role, text: b.text }));
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
    /* omp 启动帧实证序:setStatus ×2 → notify → setWidget ×2 */
    frame({ type: "extension_ui_request", method: "setStatus", id: "w1" });
    frame({ type: "extension_ui_request", method: "setStatus", id: "w2" });
    frame({ type: "extension_ui_request", method: "notify", id: "w3" });
    frame({ type: "extension_ui_request", method: "setWidget", id: "w4" });
    frame({ type: "extension_ui_request", method: "setWidget", id: "w5" });
    await vi.waitUntil(() => writes.filter((w) => w.includes("extension_ui_response")).length === 5);
    expect(writes.filter((w) => w.includes('"cancelled":true')).length).toBe(5);
    expect(blocks.length).toBe(1);
    expect(blocks[0].role).toBe("system");
    expect(blocks[0].text).toContain("×5");
    expect(blocks[0].text).toContain("setStatus ×2");
    expect(blocks[0].text).toContain("setWidget ×2");
    /* select 真交互:逐条 notice 插在聚合行后 */
    frame({ type: "extension_ui_request", method: "select", id: "q1" });
    await vi.waitUntil(() => writes.filter((w) => w.includes("extension_ui_response")).length === 6);
    expect(blocks.length).toBe(2);
    expect(blocks[1].text).toContain("CLI 发起 select 交互");
    /* 后续 chrome 取消:不回流旧聚合行,新开一条重新计数 */
    frame({ type: "extension_ui_request", method: "setStatus", id: "w6" });
    expect(blocks.length).toBe(3);
    expect(blocks[2].text).toContain("×1(setStatus");
    expect(blocks[0].text).toContain("×5"); // 旧行不被刷新
    s.kill();
  });

  it("流内 chrome 取消聚合行不被 message_end 权威落定截掉(2026-10-03 评审实锤回归)", async () => {
    let blocks: { id: string; role: string; text: string }[] = [];
    const s = new PiRpcSession({ command: "omp" }, "/ws", {
      onBlocks: (next) => {
        blocks = next.map((b) => ({ id: b.id, role: b.role, text: b.text }));
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
    /* assistant 流内来一条 setStatus(轮次中也会来,spec 自述):聚合行落消息中段 */
    frame({ type: "message_start", message: { role: "assistant", content: [] } });
    frame({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "草稿" } });
    frame({ type: "extension_ui_request", method: "setStatus", id: "m1" });
    frame({ type: "message_end", id: "e1", message: { role: "assistant", content: [{ type: "text", text: "答案" }] } });
    const agg = blocks.findIndex((b) => b.role === "system");
    const ans = blocks.findIndex((b) => b.role === "assistant");
    expect(agg).toBeGreaterThanOrEqual(0);
    expect(ans).toBeGreaterThanOrEqual(0);
    expect(blocks[agg].text).toContain("×1(setStatus");
    /* assistant 落定文本 = 流内 delta 兜底(endMsg 权威解析缺 event.id 恒空,
     * 先于本批的留观项,见 docs/review/2026-10-03-v0.2.9-range-review.md)。 */
    expect(blocks[ans].text).toBe("草稿");
    expect(agg).toBeGreaterThan(ans); // 聚合行保序在消息块之后,不被截掉
    s.kill();
  });

  it("流内 interactive notice(select)同样不被权威落定截掉(与聚合行同窗口,2026-10-03 二轮评审补)", async () => {
    let blocks: { id: string; role: string; text: string }[] = [];
    const s = new PiRpcSession({ command: "omp" }, "/ws", {
      onBlocks: (next) => {
        blocks = next.map((b) => ({ id: b.id, role: b.role, text: b.text }));
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
    frame({ type: "message_start", message: { role: "assistant", content: [] } });
    frame({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "流中" } });
    frame({ type: "extension_ui_request", method: "select", id: "q9" });
    frame({ type: "message_end", id: "e2", message: { role: "assistant", content: [{ type: "text", text: "落定" }] } });
    const notice = blocks.findIndex((b) => b.role === "system");
    const ans = blocks.findIndex((b) => b.role === "assistant");
    expect(notice).toBeGreaterThanOrEqual(0);
    expect(blocks[notice].text).toContain("CLI 发起 select 交互");
    expect(notice).toBeGreaterThan(ans); // notice 保序在消息块之后,不被截掉
    s.kill();
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
