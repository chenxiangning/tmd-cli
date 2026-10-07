/**
 * promptSent 轮次闸契约测试(shouldBroadcastPrompt / emitPromptSent)。
 * 钉死 2026-09-08 账本实证回归:ask 作答与轮中控制命令(/model 切模型)
 * 不得广播锚点信号 —— 它们在 CLI 会话流里都不是新对话轮次(JSONL 无 user 行),
 * 广播会把在途轮切成假批次、实施批错挂 "/model" 名下、批次序号与时间线脱钩。
 * W2 存证链:ranges(随发区间引用)须随广播透传,闸关闭时一并不发。
 */
import { describe, expect, it, vi } from "vitest";
import { KernelTopics } from "./events";
import { emitPromptSent, shouldBroadcastPrompt } from "./promptGate";

/* vi.hoisted:mock 工厂在 import 前执行,events 需先于工厂存在(vitest 钦定模式)。 */
const { emitted, events } = vi.hoisted(() => {
  const emitted: { topic: string; payload: unknown }[] = [];
  return {
    emitted,
    events: { emit: (topic: string, payload: unknown) => void emitted.push({ topic, payload }) },
  };
});
vi.mock("./host", () => ({
  host: { events, isWaitingConfirm: () => false, isTurnActive: () => false },
}));

const gate = (waitingConfirm: boolean, turnActive: boolean) => ({ waitingConfirm, turnActive });

describe("shouldBroadcastPrompt 轮次闸", () => {
  it("空闲普通消息:广播(开新轮)", () => {
    expect(shouldBroadcastPrompt(gate(false, false), "继续实施")).toBe(true);
  });

  it("ask 等待中作答:不广播(续当前轮,不起锚)", () => {
    expect(shouldBroadcastPrompt(gate(true, true), "大部分可以")).toBe(false);
  });

  it("轮中斜杠命令:不广播(omp /model 流中弹窗被 TUI 就地消费,实证不开轮)", () => {
    expect(shouldBroadcastPrompt(gate(false, true), "/model")).toBe(false);
  });

  it("轮中普通消息:广播(排队成真实消息,保留锚点先行语义)", () => {
    expect(shouldBroadcastPrompt(gate(false, true), "顺便把 x 也改了")).toBe(true);
  });

  it("空闲斜杠:广播(自定义命令可能展开成提示词真开轮;空封锚点不占审批线)", () => {
    expect(shouldBroadcastPrompt(gate(false, false), "/review")).toBe(true);
  });

  it("ask 等待中的斜杠:不广播(作答语义优先于命令形态)", () => {
    expect(shouldBroadcastPrompt(gate(true, true), "/model")).toBe(false);
  });
});

describe("emitPromptSent ranges 透传(W2 存证链)", () => {
  const ranges = [{ id: "m1", path: "src/a.ts", startLine: 2, endLine: 3 }];

  it("过闸广播携带 ranges,负载原样透传", () => {
    emitted.length = 0;
    emitPromptSent(gate(false, false), "s1", "改这两处", ranges);
    expect(emitted).toEqual([
      { topic: KernelTopics.promptSent, payload: { sessionId: "s1", text: "改这两处", ranges } },
    ]);
  });
  it("未携带与空名单都不落 ranges 键(toStrictEqual 区分 undefined 键,消费方按缺省处理)", () => {
    emitted.length = 0;
    emitPromptSent(gate(false, false), "s1", "无标注");
    emitPromptSent(gate(false, false), "s1", "空名单", []);
    expect(emitted.map((e) => e.payload)).toStrictEqual([
      { sessionId: "s1", text: "无标注" },
      { sessionId: "s1", text: "空名单" },
    ]);
  });

  it("闸关闭(ask 作答)不广播:ranges 随之不落", () => {
    emitted.length = 0;
    emitPromptSent(gate(true, true), "s1", "大部分可以", ranges);
    expect(emitted).toEqual([]);
  });
});
