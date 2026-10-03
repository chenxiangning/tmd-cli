/**
 * 发送闸真值表:三在途条件任一为真即封发(send() 本体硬闸的契约钉死,
 * 删掉 SessionScreen 本体闸时此表红 —— 2026-10-03 二轮评审补测试缺口)。
 */
import { describe, expect, it } from "vitest";
import { canSend } from "./sendGate";

describe("canSend 发送闸", () => {
  it("三条件全空闲才放行", () => {
    expect(canSend(false, false, false)).toBe(true);
  });
  it("任一在途即封发(其余两态无关)", () => {
    expect(canSend(true, false, false)).toBe(false); /* 发送在途:双击不双写 */
    expect(canSend(false, true, false)).toBe(false); /* 上传在途:图未挂完先发文字 */
    expect(canSend(false, false, true)).toBe(false); /* 选图中:结果未定 */
    expect(canSend(true, true, true)).toBe(false);
    expect(canSend(true, true, false)).toBe(false);
    expect(canSend(false, true, true)).toBe(false);
    expect(canSend(true, false, true)).toBe(false);
  });
});
