/**
 * promptSent 轮次闸契约测试(shouldBroadcastPrompt)。
 * 钉死 2026-09-08 账本实证回归:ask 作答与轮中控制命令(/model 切模型)
 * 不得广播锚点信号 —— 它们在 CLI 会话流里都不是新对话轮次(JSONL 无 user 行),
 * 广播会把在途轮切成假批次、实施批错挂 "/model" 名下、批次序号与时间线脱钩。
 */
import { describe, expect, it } from "vitest";
import { shouldBroadcastPrompt } from "./promptGate";

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
