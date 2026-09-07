/**
 * 审批/提问卡状态契约(纯 fake IO):键盘选中→确认、raw 即时应答、
 * 文本兜底、Esc 语义、即时应答后 pending 清账。防「问答割裂」回归。
 */

import { describe, expect, it, vi } from "vitest";
import { createMenu, move, current, windowTop, renderLines, MAX_VISIBLE } from "./dsh-menu.cjs";
import { createPendingCards } from "./dsh-pending.cjs";
import type { PendingInfo } from "./dsh-pending.cjs";

const menu = { createMenu, move, current, windowTop, renderLines, MAX_VISIBLE };

function harness() {
  const pending = new Map<string, PendingInfo>();
  const respondApproval = vi.fn();
  const respondQuestion = vi.fn();
  const respondQuestionCancel = vi.fn();
  const print = { print: () => undefined, write: () => undefined, nl: () => undefined,
    status: () => undefined, error: () => undefined };
  const render = { band: (_n: string, l: string) => l };
  const zone = { show: () => undefined, hide: () => undefined, eraseAndHide: () => undefined,
    isOpen: () => true, hit: () => false };
  const cards = createPendingCards({
    print, render, zone, menu, pending, ORIGIN: "http://x",
    respondApproval, respondQuestion, respondQuestionCancel,
  });
  return { pending, cards, respondApproval, respondQuestion, respondQuestionCancel };
}
const APPROVAL: PendingInfo = { kind: "approval", sessionId: "s1", approvalId: "a1", toolName: "bash" };
const QUESTION: PendingInfo = {
  kind: "question", sessionId: "s1",
  questions: [{ id: "q1", header: "颜色", options: [{ label: "红" }, { label: "蓝" }, { label: "绿" }] }],
};

describe("审批卡", () => {
  it("↓ 移选中 → Enter 应答拒绝", () => {
    const { pending, cards, respondApproval } = harness();
    pending.set("r1", APPROVAL);
    cards.showApproval("r1", APPROVAL);
    cards.onKey("down");
    cards.onLine("");
    expect(respondApproval).toHaveBeenCalledWith("http://x", "r1", "s1", "a1", "rejected");
    expect(pending.size).toBe(0);
  });
  it("raw y 即时允许且 pending 清账", () => {
    const { pending, cards, respondApproval } = harness();
    pending.set("r1", APPROVAL);
    cards.showApproval("r1", APPROVAL);
    expect(cards.onChar("y")).toBe(true);
    expect(respondApproval).toHaveBeenCalledWith("http://x", "r1", "s1", "a1", "allowed-once");
    expect(cards.onLine("y")).toBe(false); /* 已结算:二次作答不消费 */
  });
  it("Esc = 拒绝", () => {
    const { cards, respondApproval } = harness();
    cards.showApproval("r2", APPROVAL);
    cards.onKey("esc");
    expect(respondApproval).toHaveBeenCalledWith("http://x", "r2", "s1", "a1", "rejected");
  });
});

describe("提问卡", () => {
  it("↑↓ 循环 + Enter 应答选中项", () => {
    const { pending, cards, respondQuestion } = harness();
    pending.set("r1", QUESTION);
    cards.showQuestion("r1", QUESTION);
    cards.onKey("down");
    cards.onKey("down");
    cards.onLine("");
    /* 官方 answers 数组线格式(对象 map 会被 host zod 拒 → 轮次永挂) */
    expect(respondQuestion).toHaveBeenCalledWith("http://x", "r1", "s1", [
      { id: "q1", selected: ["绿"] },
    ]);
  });
  it("数字即时应答(可视窗直达)", () => {
    const { cards, respondQuestion } = harness();
    cards.showQuestion("r1", QUESTION);
    expect(cards.onChar("2")).toBe(true);
    expect(respondQuestion).toHaveBeenCalledWith("http://x", "r1", "s1", [
      { id: "q1", selected: ["蓝"] },
    ]);
  });
  it("多问单答:未答问题带空 selected 一并送达", () => {
    const { cards, respondQuestion } = harness();
    const two = {
      kind: "question", sessionId: "s1",
      questions: [
        { id: "qa", header: "A", options: [{ label: "x" }] },
        { id: "qb", header: "B", options: [{ label: "y" }] },
      ],
    } as PendingInfo;
    cards.showQuestion("r9", two);
    cards.onChar("1"); /* 第一题 x */
    expect(respondQuestion).toHaveBeenCalledWith("http://x", "r9", "s1", [
      { id: "qa", selected: ["x"] },
      { id: "qb", selected: [] },
    ]);
  });
  it("卡收起后文本「题:选」兜底仍可作答", () => {
    const { pending, cards, respondQuestion } = harness();
    pending.set("r1", QUESTION);
    cards.showQuestion("r1", QUESTION);
    cards.closeFor("会话输出到达");
    expect(cards.onLine("1:3")).toBe(true);
    expect(respondQuestion).toHaveBeenCalledWith("http://x", "r1", "s1", [
      { id: "q1", selected: ["绿"] },
    ]);
  });
  it("单问自由文本 = custom 应答(绝不漏进 prompt 队列)", () => {
    const { pending, cards, respondQuestion } = harness();
    pending.set("r1", QUESTION);
    cards.showQuestion("r1", QUESTION);
    cards.closeFor("会话输出到达");
    expect(cards.onLine("我想重新回答")).toBe(true);
    expect(respondQuestion).toHaveBeenCalledWith("http://x", "r1", "s1", [
      { id: "q1", selected: [], custom: "我想重新回答" },
    ]);
  });
  it("多问自由文本被消费并提示(防漏队列,不猜意图)", () => {
    const { pending, cards, respondQuestion } = harness();
    const two = {
      kind: "question", sessionId: "s1",
      questions: [
        { id: "qa", header: "A", options: [{ label: "x" }] },
        { id: "qb", header: "B", options: [{ label: "y" }] },
      ],
    } as PendingInfo;
    pending.set("r9", two);
    cards.showQuestion("r9", two);
    expect(cards.onLine("随便说点什么")).toBe(true);
    expect(respondQuestion).not.toHaveBeenCalled();
  });
});
