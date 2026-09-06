/**
 * 用户消息锚点提取测试(grok / qoder 行型)—— 自 userMessages.test.ts 按主题拆出:
 * grok 只收 <user_query> 包裹的真实输入;qoder 只收 origin.kind=human 的用户行。
 */

import { describe, expect, it } from "vitest";
import { vi } from "vitest";

/* 与主测试文件同款 ipc mock:userMessages 模块 import 链带 @kernel/ipc,vitest 下必须有 mock。 */
const fsReadTail = vi.fn();
vi.mock("@kernel/ipc", () => ({
  ipc: { fsReadTail: (...args: unknown[]) => fsReadTail(...args) },
}));
import {
  grokUserMessageLine,
  qoderUserMessageLine,
  parseUserMessages,
} from "./userMessages";

describe("grokUserMessageLine", () => {
  it("提取 <user_query> 包裹的真实输入(实证行型:content 直挂 event)", () => {
    const line = JSON.stringify({
      type: "user",
      content: [{ type: "text", text: "<user_query>\n在吗\n</user_query>" }],
    });
    const messages = parseUserMessages(line, grokUserMessageLine);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("在吗");
    expect(messages[0].id).toMatch(/^gk:[0-9a-f]{8}$/);
  });

  it("system-reminder / skill 注入行无 user_query 包裹,跳过", () => {
    const reminder = JSON.stringify({
      type: "user",
      content: [
        {
          type: "text",
          text: "<system-reminder>\nThe following skills are available:\n- coss</system-reminder>",
        },
      ],
    });
    expect(parseUserMessages(reminder, grokUserMessageLine)).toEqual([]);
  });

  it("assistant/reasoning/system 行与字符串 content 都跳过", () => {
    const assistant = JSON.stringify({
      type: "assistant",
      content: "在的。需要我帮你做什么？",
      model_id: "grok-4.6-build",
    });
    const reasoning = JSON.stringify({ type: "reasoning", content: [] });
    const system = JSON.stringify({ type: "system", content: "You are Grok" });
    const stringContent = JSON.stringify({
      type: "user",
      content: "<user_query>字符串 content 不是实证行型</user_query>",
    });
    expect(
      parseUserMessages(`${assistant}\n${reasoning}\n${system}\n${stringContent}`, grokUserMessageLine),
    ).toEqual([]);
  });

  it("id = 文本 FNV-1a hash:同文重复折叠同 id(去重契约),异文不同 id", () => {
    const mk = (text: string) =>
      JSON.stringify({
        type: "user",
        content: [{ type: "text", text: `<user_query>${text}</user_query>` }],
      });
    const messages = parseUserMessages(`${mk("继续")}\n${mk("继续")}\n${mk("停")}`, grokUserMessageLine);
    expect(messages).toHaveLength(3);
    expect(messages[0].id).toBe(messages[1].id);
    expect(messages[2].id).not.toBe(messages[0].id);
  });
});

describe("qoderUserMessageLine", () => {
  const humanLine = JSON.stringify({
    type: "user",
    uuid: "5810de9c-6a8e",
    message: { role: "user", content: [{ type: "text", text: "在吗" }] },
    origin: { kind: "human" },
  });

  it("origin.kind=human 的用户行提取为锚点(实证行型)", () => {
    expect(parseUserMessages(humanLine, qoderUserMessageLine)).toEqual([
      { id: "5810de9c-6a8e", text: "在吗" },
    ]);
  });

  it("origin.kind 非 human / origin 缺失 / sidechain 都跳过", () => {
    const injected = JSON.stringify({
      type: "user",
      uuid: "u2",
      message: { role: "user", content: [{ type: "text", text: "注入" }] },
      origin: { kind: "system" },
    });
    const noOrigin = JSON.stringify({
      type: "user",
      uuid: "u3",
      message: { role: "user", content: [{ type: "text", text: "无 origin" }] },
    });
    const sidechain = JSON.stringify({
      type: "user",
      uuid: "u4",
      isSidechain: true,
      origin: { kind: "human" },
      message: { role: "user", content: [{ type: "text", text: "子代理" }] },
    });
    expect(parseUserMessages(injected, qoderUserMessageLine)).toEqual([]);
    expect(parseUserMessages(noOrigin, qoderUserMessageLine)).toEqual([]);
    expect(parseUserMessages(sidechain, qoderUserMessageLine)).toEqual([]);
  });
});
