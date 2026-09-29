/**
 * 会话 tab 状态推导契约 —— 并行会话三态可见性(tab 点位 + 标题后缀的唯一数据源)。
 * 优先级:等待确认 > (无对话基线) > 运行中 > 未读 > 空闲。
 * 背景:2026-09-29 用户报并行 omp 会话「界面假死」误判——空闲会话在 tab 条
 * 无任何信号(仅等待确认/未读有点),空闲与死的观感不可分。
 */
import { describe, expect, it } from "vitest";
import { sessionTabState } from "./sessionTabState";

describe("sessionTabState 优先级真值表", () => {
  it("等待确认压倒一切:轮次在途/未读/未锚定同时为真仍报 waiting", () => {
    expect(sessionTabState(true, false, false, 1000)).toBe("waiting");
    expect(sessionTabState(true, false, false, 0)).toBe("waiting"); /* 未锚定也可 ask(askWatch 无锚定闸):等待确认仍压倒无基线 */
    expect(sessionTabState(true, true, false, 1000)).toBe("waiting");
    expect(sessionTabState(true, false, true, 1000)).toBe("waiting");
  });

  it("无对话基线(lastActivityAt=0,spawn 启动期/未锚定)= none:不出点不冒充空闲", () => {
    expect(sessionTabState(false, false, false, 0)).toBe("none");
  });

  it("轮次在途 = running(有基线前提下)", () => {
    expect(sessionTabState(false, true, false, 1000)).toBe("running");
    expect(sessionTabState(false, true, true, 1000)).toBe("running");
  });

  it("结算未读 = unread(蓝点既有语义)", () => {
    expect(sessionTabState(false, false, true, 1000)).toBe("unread");
  });

  it("有基线且已结算已读 = idle(空闲待输入,tab 条灰点 + 标题后缀)", () => {
    expect(sessionTabState(false, false, false, 1000)).toBe("idle");
  });
});
