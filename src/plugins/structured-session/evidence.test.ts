import { describe, expect, it, vi } from "vitest";
import { KernelTopics } from "@kernel/events";
import type { CliTranscriptBlock } from "@kernel/cli";

const emit = vi.hoisted(() => vi.fn());
vi.mock("@kernel/host", () => ({ host: { events: { emit } } }));
vi.mock("@plugins/checkpoints/store", () => ({ captureAnchor: vi.fn(), recordEdit: vi.fn(), sealTurn: vi.fn() }));

import { StructuredTurnEvidence } from "./evidence";
import { lastRetryablePrompt } from "./retryPrompt";

const META = { engine: "omp", model: "m1", thinking: "high" };
const CWD = "/repo";
const LEDGER = "structured:omp:/repo";

function deps() {
  return {
    capture: vi.fn(() => Promise.resolve()),
    record: vi.fn(() => Promise.resolve()),
    seal: vi.fn((cwd: string, sessionId: string, tmdSessionId: string, onSealed?: (cwd: string, sessionId: string, tmdSessionId: string) => void) => {
      onSealed?.(cwd, sessionId, tmdSessionId);
      return Promise.resolve();
    }),
  };
}

describe("StructuredTurnEvidence(RPC 共同存证)", () => {
  it("prompt → 成功 write → settled：同一身份打锚、记写、封口并广播足迹事件", async () => {
    const d = deps();
    const evidence = new StructuredTurnEvidence(CWD, LEDGER, d);
    evidence.prompt("cli-1", "修改说明", META);
    evidence.toolExecution({ type: "tool_execution_start", toolCallId: "w1", toolName: "write", args: { path: "docs/a.md" } });
    evidence.toolExecution({ type: "tool_execution_end", toolCallId: "w1", toolName: "write", result: {} });
    await evidence.settled();

    expect(d.capture).toHaveBeenCalledWith(CWD, "cli-1", LEDGER, "修改说明", META, "events");
    expect(d.record).toHaveBeenCalledWith(CWD, "cli-1", LEDGER, "docs/a.md");
    expect(d.seal).toHaveBeenCalledWith(CWD, "cli-1", LEDGER, expect.any(Function));
    expect(emit).toHaveBeenCalledWith(KernelTopics.ckptTurnSealed, { cwd: CWD, sessionId: "cli-1", tmdSessionId: LEDGER });
  });

  it("失败 write/edit 与成功其他工具均不入账；无 prompt 的 settled 不伪造完成", async () => {
    const d = deps();
    const evidence = new StructuredTurnEvidence(CWD, LEDGER, d);
    evidence.prompt("cli-1", "试写", META);
    evidence.toolExecution({ type: "tool_execution_end", toolCallId: "e1", toolName: "edit", args: { path: "a.ts" }, isError: true });
    evidence.toolExecution({ type: "tool_execution_end", toolCallId: "b1", toolName: "bash", args: { path: "b.ts" } });
    expect(d.record).not.toHaveBeenCalled();

    await evidence.settled();
    expect(d.seal).toHaveBeenCalledTimes(1);
    await evidence.settled();
    expect(d.seal).toHaveBeenCalledTimes(1);
  });

  it("busy 排队 prompt 等到 agent_start 才开新锚；resume 换 CLI id 仍用原账本副键", async () => {
    const d = deps();
    const evidence = new StructuredTurnEvidence(CWD, LEDGER, d);
    evidence.prompt("cli-old", "排队任务", META, true);
    expect(d.capture).not.toHaveBeenCalled();
    evidence.agentStart("cli-old");
    await evidence.settled();
    evidence.prompt("cli-new", "续聊任务", META);
    await evidence.settled();
    expect(d.capture).toHaveBeenNthCalledWith(2, CWD, "cli-new", LEDGER, "续聊任务", META, "events");
  });

  it("reset 丢弃旧进程未发队列,不把旧任务锚到 resume 新会话", async () => {
    const d = deps();
    const evidence = new StructuredTurnEvidence(CWD, LEDGER, d);
    evidence.prompt("cli-old", "旧进程排队任务", META, true);
    evidence.reset();
    evidence.agentStart("cli-new");
    await evidence.settled();
    expect(d.capture).not.toHaveBeenCalled();
    expect(d.seal).not.toHaveBeenCalled();
  });

  it("settled 清除未结束工具,迟到 end 不补记到下一轮", async () => {
    const d = deps();
    const evidence = new StructuredTurnEvidence(CWD, LEDGER, d);
    evidence.prompt("cli-1", "第一轮", META);
    evidence.toolExecution({ type: "tool_execution_start", toolCallId: "w1", toolName: "write", args: { path: "a.ts" } });
    await evidence.settled();
    evidence.prompt("cli-1", "第二轮", META);
    evidence.toolExecution({ type: "tool_execution_end", toolCallId: "w1", result: {} });
    await evidence.settled();
    expect(d.record).not.toHaveBeenCalled();
  });

  it("seal 等待前序 anchor 与 write 全部完成,不允许反序落账", async () => {
    const d = deps();
    const gate = Promise.withResolvers<void>();
    const order: string[] = [];
    d.capture.mockImplementation(() => gate.promise.then(() => { order.push("anchor"); }));
    d.record.mockImplementation(() => { order.push("edit"); return Promise.resolve(); });
    d.seal.mockImplementation(() => { order.push("seal"); return Promise.resolve(); });
    const evidence = new StructuredTurnEvidence(CWD, LEDGER, d);
    evidence.prompt("cli-1", "修改说明", META);
    evidence.toolExecution({ type: "tool_execution_end", toolCallId: "w1", toolName: "write", args: { path: "a.ts" } });
    const done = evidence.settled();

    expect(d.seal).not.toHaveBeenCalled();
    gate.resolve();
    await done;
    expect(order).toEqual(["anchor", "edit", "seal"]);
  });
});

describe("lastRetryablePrompt(只预览真实用户任务)", () => {
  const user = (id: string, text: string): CliTranscriptBlock => ({ id, role: "user", text });

  it("跳过尾部控制命令、接力外壳和系统包装，取最后真实用户块", () => {
    expect(lastRetryablePrompt([
      user("u1", "  修复上一回合  "),
      user("u2", "接力自 omp 会话\n摘要"),
      user("u3", "/compact"),
      user("u4", "<system-reminder>忽略</system-reminder>"),
      { id: "a1", role: "assistant", text: "回答" },
    ])).toBe("修复上一回合");
  });

  it("没有真实用户块时无死按钮数据源", () => {
    expect(lastRetryablePrompt([user("u1", "/compact"), { id: "a1", role: "assistant", text: "回答" }])).toBeNull();
  });
});
