/** 模型位可点性真值表 —— 回归钉:WSL 重构(b7fe1c71)曾把 omp 轮中豁免收丢,
 *  声明 modelCommandMidTurn 的 CLI 轮中点击被静默禁用(「卡住,选择内容不出现」,
 *  2026-10-24 用户实证)。t() 在测试态回源键,断言即中文键面。 */
import { describe, expect, it } from "vitest";
import { modelClickState } from "./modelClickState";

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

  it("空闲:恒可点(豁免声明与否无关)", () => {
    expect(modelClickState(false, false, false).clickable).toBe(true);
    expect(modelClickState(false, false, true).clickable).toBe(true);
  });
});
