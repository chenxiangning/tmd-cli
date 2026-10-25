/** 模型位/思考位可点性真值表 —— 回归钉①:WSL 重构(b7fe1c71)曾把 omp 轮中豁免
 *  收丢,声明 modelCommandMidTurn 的 CLI 轮中点击被静默禁用(「卡住,选择内容
 *  不出现」,2026-10-24 用户实证);回归钉②:ask 等待期只拦了写入与模型位,
 *  思考位在静默超阈(turnActive 翻 false)后假活可点(2026-10-24 评审 P2)。
 *  t() 在测试态回源键,断言即中文键面。 */
import { describe, expect, it } from "vitest";
import { modelClickState, thinkingSlotState } from "./modelClickState";

describe("模型位可点性", () => {
  it("无会话:不可点", () => {
    const s = modelClickState(true, false, true);
    expect(s.clickable).toBe(false);
    expect(s.title).toBe("未识别模型");
  });

  it("对话进行中且未声明轮中豁免:不可点(输入会串进输出流)", () => {
    const s = modelClickState(false, true, false);
    expect(s.clickable).toBe(false);
    expect(s.title).toBe("对话进行中,本轮结束后可点击切换模型");
  });

  it("对话进行中但声明轮中豁免(omp):可点——回归主断言", () => {
    expect(modelClickState(false, true, true).clickable).toBe(true);
  });

  it("ask 等待期:恒禁(豁免与否无关,写入会被当作答案文本)", () => {
    expect(modelClickState(false, true, true, true).clickable).toBe(false);
    expect(modelClickState(false, true, false, true).title).toBe("等待确认中,先在面板作答");
  });

  it("空闲:恒可点(豁免声明与否无关)", () => {
    expect(modelClickState(false, false, false).clickable).toBe(true);
    expect(modelClickState(false, false, true).clickable).toBe(true);
  });
});

describe("思考位可点性", () => {
  it("ask 等待期:恒禁——回归主断言(静默超阈 turnActive=false 也不得假活)", () => {
    expect(thinkingSlotState(false, true)).toEqual({ disabled: true, title: "等待确认中,先在面板作答" });
    expect(thinkingSlotState(true, true).disabled).toBe(true);
  });

  it("对话进行中:禁;空闲:可点", () => {
    expect(thinkingSlotState(true)).toEqual({ disabled: true, title: "对话进行中,本轮结束后可点击" });
    expect(thinkingSlotState(false)).toEqual({ disabled: false, title: "点击打开思考强度选择" });
  });
});
