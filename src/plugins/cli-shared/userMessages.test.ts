/**
 * 用户消息锚点提取测试 —— 四种 CLI 行型的解析契约:
 * 只收真实用户输入;tool_result / XML 包装 / AGENTS.md 指令包装 / claude sidechain 一律跳过。
 */

import { describe, expect, it } from "vitest";
import { vi } from "vitest";

/* ipc mock:readUserMessagesFromFile 的成败语义是 2026-09-02 事故点(读失败≠零消息)。 */
const fsReadTail = vi.fn();
vi.mock("@kernel/ipc", () => ({
  ipc: { fsReadTail: (...args: unknown[]) => fsReadTail(...args) },
}));
import {
  claudeUserMessageLine,
  codexUserMessageLine,
  ompPiUserMessageLine,
  parseUserMessages,
  readUserMessagesFromFile,
} from "./userMessages";

describe("ompPiUserMessageLine", () => {
  it("提取 type:message + role:user 的文本与 id", () => {
    const line = JSON.stringify({
      type: "message",
      id: "46ea0a51",
      message: { role: "user", content: [{ type: "text", text: "加个锚点栏" }] },
    });
    expect(parseUserMessages(line, ompPiUserMessageLine)).toEqual([
      { id: "46ea0a51", text: "加个锚点栏" },
    ]);
  });

  it("多 text 段拼接;tool_result 段跳过", () => {
    const line = JSON.stringify({
      type: "message",
      id: "m1",
      message: {
        role: "user",
        content: [
          { type: "text", text: "第一段" },
          { type: "tool_result", content: "不应出现" },
          { type: "text", text: "第二段" },
        ],
      },
    });
    expect(parseUserMessages(line, ompPiUserMessageLine)).toEqual([
      { id: "m1", text: "第一段\n第二段" },
    ]);
  });

  it("assistant 消息 / 纯 tool_result user 行 / 坏行都跳过", () => {
    const assistant = JSON.stringify({
      type: "message",
      id: "a1",
      message: { role: "assistant", content: [{ type: "text", text: "模型回复" }] },
    });
    const toolResult = JSON.stringify({
      type: "message",
      id: "t1",
      message: { role: "user", content: [{ type: "tool_result", content: "x" }] },
    });
    const broken = `{"type":"message","id":"b1","message":{"role":"user","con`;
    expect(
      parseUserMessages([assistant, toolResult, broken].join("\n"), ompPiUserMessageLine),
    ).toEqual([]);
  });

  it("XML 包装与无 id 行跳过", () => {
    const xml = JSON.stringify({
      type: "message",
      id: "x1",
      message: { role: "user", content: [{ type: "text", text: "<system-reminder>…</system-reminder>" }] },
    });
    const noId = JSON.stringify({
      type: "message",
      message: { role: "user", content: [{ type: "text", text: "没 id" }] },
    });
    expect(parseUserMessages([xml, noId].join("\n"), ompPiUserMessageLine)).toEqual([]);
  });
});

describe("claudeUserMessageLine", () => {
  it("type:user + uuid;string content 也收", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "u-1",
      message: { role: "user", content: "直接字符串消息" },
    });
    expect(parseUserMessages(line, claudeUserMessageLine)).toEqual([
      { id: "u-1", text: "直接字符串消息" },
    ]);
  });

  it("sidechain(subagent)消息跳过", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "u-2",
      isSidechain: true,
      message: { role: "user", content: [{ type: "text", text: "子代理内部输入" }] },
    });
    expect(parseUserMessages(line, claudeUserMessageLine)).toEqual([]);
  });
});

describe("codexUserMessageLine", () => {
  it("response_item 包装 + input_text", () => {
    const line = JSON.stringify({
      type: "response_item",
      payload: {
        id: "p-1",
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "codex 消息" }],
      },
    });
    expect(parseUserMessages(line, codexUserMessageLine)).toEqual([
      { id: "p-1", text: "codex 消息" },
    ]);
  });

  it("AGENTS.md 指令包装跳过", () => {
    const line = JSON.stringify({
      type: "response_item",
      payload: {
        id: "p-2",
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "# AGENTS.md instructions for /repo\n…" }],
      },
    });
    expect(parseUserMessages(line, codexUserMessageLine)).toEqual([]);
  });
});

describe("parseUserMessages 通用行为", () => {
  it("保持文件顺序;role 预筛不挡 user 行", () => {
    const lines = [
      JSON.stringify({ type: "session", id: "s", title: "无关行" }),
      JSON.stringify({
        type: "message",
        id: "1",
        message: { role: "user", content: [{ type: "text", text: "先" }] },
      }),
      JSON.stringify({
        type: "message",
        id: "2",
        message: { role: "assistant", content: [{ type: "text", text: "回复" }] },
      }),
      JSON.stringify({
        type: "message",
        id: "3",
        message: { role: "user", content: [{ type: "text", text: "后" }] },
      }),
    ].join("\n");
    expect(parseUserMessages(lines, ompPiUserMessageLine).map((m) => m.text)).toEqual([
      "先",
      "后",
    ]);
  });
});
describe("readUserMessagesFromFile 成败语义", () => {
  it("读取失败返回 null(调用方不得推进 fullLoaded)", async () => {
    fsReadTail.mockRejectedValueOnce(new Error("文件超过 512KB，暂不支持预览"));
    expect(await readUserMessagesFromFile("/x.jsonl", true, ompPiUserMessageLine)).toBeNull();
  });

  it("读取成功但没有用户消息返回 [](合法空,推进 fullLoaded)", async () => {
    fsReadTail.mockResolvedValueOnce('{"type":"session","id":"s1"}');
    expect(await readUserMessagesFromFile("/x.jsonl", true, ompPiUserMessageLine)).toEqual([]);
  });

  it("full 走 32MB 大窗口(不经 512KB 预览上限的 fsReadFile)", async () => {
    fsReadTail.mockResolvedValueOnce("");
    await readUserMessagesFromFile("/x.jsonl", true, ompPiUserMessageLine);
    expect(fsReadTail).toHaveBeenCalledWith("/x.jsonl", 32 * 1024 * 1024);
  });
});
