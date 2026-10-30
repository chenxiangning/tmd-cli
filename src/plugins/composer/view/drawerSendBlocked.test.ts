/**
 * 抽屉 send 闸纯判定回归(2026-10-25,0.4.5 批次 A-1):
 * ask 等待期抽屉 send 项一律拦截 —— 直接写入会被 CLI 当作答案文本提交,
 * 与模型位/思考位(modelClickState)同律;非等待期放行(null)。
 * 桌面三入口统一口径:chip 位(0.4.4)→ ⌘K 抽屉(本件)→ mobile chip(另测);
 * 输入框直敲不拦(2026-09-13 裁定:ask 期 composer 即作答通道,见 promptGate ponytail)。
 */
import { describe, expect, it } from "vitest";
import { drawerSendBlocked } from "./useComposerDrawer";

describe("drawerSendBlocked", () => {
  it("ask 等待期:拦截并给出与模型位同律的文案", () => {
    expect(drawerSendBlocked(true)).toBe("等待确认中,先在面板作答");
  });

  it("非等待期:放行", () => {
    expect(drawerSendBlocked(false)).toBeNull();
  });
});
