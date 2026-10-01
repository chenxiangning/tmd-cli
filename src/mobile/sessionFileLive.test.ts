/**
 * pollTranscript 增量拍回归(spec 2026-09-25-mobile-session-render):
 * 尺寸闸 unchanged 短路、changed 整窗重解析、半行/乱码 0 解析保旧态、IPC 失败 null。
 */
import { describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@kernel/transport", () => ({ invoke: invokeMock }));

import { pollTranscript } from "./sessionFile";

const PATH = "/home/u/.omp/agent/sessions/--Users-x-code-tmd-cli-/s1.jsonl";
const PI_USER = JSON.stringify({
  type: "message",
  message: { role: "user", content: [{ type: "text", text: "你好" }] },
});

describe("pollTranscript 增量拍", () => {
  it("unchanged 短路 → null(不 setState)", async () => {
    invokeMock.mockResolvedValueOnce({ changed: false, size: 120, text: "" });
    expect(await pollTranscript(PATH, 120)).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith("fs_read_tail_changed", {
      path: PATH,
      maxBytes: 262144,
      lastSize: 120,
    });
  });

  it("changed → 整窗重解析 + size 回传", async () => {
    invokeMock.mockResolvedValueOnce({
      changed: true,
      size: 240,
      text: `${PI_USER}\n${PI_USER}\n`,
    });
    const r = await pollTranscript(PATH, 120);
    expect(r).not.toBeNull();
    expect(r!.size).toBe(240);
    expect(r!.turns).toHaveLength(2);
    expect(r!.turns[0]).toEqual({ role: "user", text: "你好" });
  });

  it("变化但解析 0 行(半行/未识别)→ null 保旧态,size 不同步", async () => {
    invokeMock.mockResolvedValueOnce({ changed: true, size: 130, text: '{"type":"thin' });
    expect(await pollTranscript(PATH, 120)).toBeNull();
  });

  it("IPC 失败 → null(UI 回落实况,不抛)", async () => {
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    expect(await pollTranscript(PATH, null)).toBeNull();
  });
});

/* 2026-09-28 契约扩展:codex/kimi 走插件行解析器(行型自证分发),
 * 块 → turns 映射:reasoning 丢弃、tool 配对后取 shell 命令摘要。 */
const CODEX_TEXT = [
  JSON.stringify({
    type: "session_meta",
    id: "0192f0c1-1111-2222-3333-444455556666",
    cwd: "/w",
    timestamp: "2026-09-28T00:00:00.000Z",
  }),
  JSON.stringify({
    type: "response_item",
    timestamp: "2026-09-28T00:00:01.000Z",
    payload: {
      type: "message",
      role: "user",
      id: "u1",
      content: [{ type: "input_text", text: "跑下测试" }],
    },
  }),
  JSON.stringify({
    type: "response_item",
    timestamp: "2026-09-28T00:00:02.000Z",
    payload: {
      type: "reasoning",
      id: "r1",
      content: [{ type: "reasoning_text", text: "内心戏不上图" }],
    },
  }),
  JSON.stringify({
    type: "response_item",
    timestamp: "2026-09-28T00:00:03.000Z",
    payload: {
      type: "function_call",
      id: "c1",
      name: "exec_command",
      call_id: "call1",
      arguments: JSON.stringify({ cmd: "pnpm test" }),
    },
  }),
  JSON.stringify({
    type: "response_item",
    timestamp: "2026-09-28T00:00:04.000Z",
    payload: { type: "function_call_output", call_id: "call1", output: "done" },
  }),
  JSON.stringify({
    type: "response_item",
    timestamp: "2026-09-28T00:00:05.000Z",
    payload: {
      type: "message",
      role: "assistant",
      id: "a1",
      content: [{ type: "output_text", text: "全绿" }],
    },
  }),
].join("\n");

const KIMI_TEXT = [
  JSON.stringify({
    type: "turn.prompt",
    origin: { kind: "user" },
    input: [{ type: "text", text: "看下仓库" }],
    promptId: "p1",
    time: 1,
  }),
  JSON.stringify({
    type: "context.append_loop_event",
    time: 2,
    event: { type: "tool.call", uuid: "t1", toolCallId: "tc1", name: "bash", args: { command: "git status" } },
  }),
  JSON.stringify({
    type: "context.append_loop_event",
    time: 3,
    event: { type: "content.part", uuid: "a1", part: { type: "text", text: "干净" } },
  }),
].join("\n");

describe("pollTranscript 行型自证(codex/kimi 插件解析器)", () => {
  it("codex rollout:user/tool/assistant,reasoning 丢弃,tool 摘要取命令", async () => {
    invokeMock.mockResolvedValueOnce({ changed: true, size: 999, text: CODEX_TEXT });
    const r = await pollTranscript("/home/u/.codex/sessions/x.jsonl", null);
    expect(r!.turns).toEqual([
      { role: "user", text: "跑下测试" },
      { role: "tool", tool: "exec_command", text: "pnpm test" },
      { role: "assistant", text: "全绿" },
    ]);
  });

  it("kimi wire:turn.prompt 用户块 + tool.call 工具块 + text 助手块", async () => {
    invokeMock.mockResolvedValueOnce({ changed: true, size: 999, text: KIMI_TEXT });
    const r = await pollTranscript("/home/u/.kimi-code/sessions/w/session_x/agents/main/wire.jsonl", null);
    expect(r!.turns).toEqual([
      { role: "user", text: "看下仓库" },
      { role: "tool", tool: "bash", text: "git status" },
      { role: "assistant", text: "干净" },
    ]);
  });

  it("MAX_TURNS 尾窗截断仍生效(插件解析路径同限)", async () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      JSON.stringify({
        type: "turn.prompt",
        origin: { kind: "user" },
        input: [{ type: "text", text: `m${i}` }],
        promptId: `p${i}`,
        time: i,
      }),
    ).join("\n");
    invokeMock.mockResolvedValueOnce({ changed: true, size: 999, text: many });
    const r = await pollTranscript("/w.jsonl", null);
    expect(r!.turns).toHaveLength(40);
    expect(r!.turns[0]).toEqual({ role: "user", text: "m10" });
  });
});
