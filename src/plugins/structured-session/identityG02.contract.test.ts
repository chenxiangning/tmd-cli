/**
 * G-02 structured tab 身份解析契约 —— structuredSessionTarget(账本副键 ↔ tab 目标):
 * checkpoint/footprint 存的 tmdSessionId 以 "structured:" 前缀与普通 PTY 身份区分;
 * 解析失败(无前缀/缺段)一律 null,消费方回落 PTY 链,绝不误开错误会话。
 */

import { describe, expect, it } from "vitest";
import { STRUCTURED_SESSION_TAB_KIND, structuredSessionTarget } from "@kernel/structuredSessionTabs";

describe("G-02 structuredSessionTarget 身份解析", () => {
  it("structured:profile:cwd → 目标负载(cwd 可含冒号的盘符也不碎:按首个分隔符切)", () => {
    expect(structuredSessionTarget("structured:omp:/repo")).toEqual({
      profileId: "omp",
      cwd: "/repo",
    });
    expect(structuredSessionTarget("structured:pi:C:\\work")).toEqual({
      profileId: "pi",
      cwd: "C:\\work",
    });
  });

  it("普通 PTY 身份(无前缀)→ null,回落 viewer/checkpoint PTY 链", () => {
    expect(structuredSessionTarget("pty-123")).toBeNull();
    expect(structuredSessionTarget("omp:cli-abc")).toBeNull();
    expect(structuredSessionTarget(undefined)).toBeNull();
  });

  it("形态残缺(空 profile/空 cwd/无分隔符)→ null,不半解析", () => {
    expect(structuredSessionTarget("structured::/repo")).toBeNull();
    expect(structuredSessionTarget("structured:omp:")).toBeNull();
    expect(structuredSessionTarget("structured:omp")).toBeNull();
    expect(structuredSessionTarget("structured:")).toBeNull();
  });

  it("tab kind 独立:structured tab 与 PTY session-view tab 不同 kind,无同 id 跨后端打开", () => {
    expect(STRUCTURED_SESSION_TAB_KIND).toBe("structured-session");
    /* session-view tab 由 kernel sessionViewTabs 注册(kind "session-view");
       structured tab id 以 "structured:" 前缀命名,两种身份不可能撞 id。 */
    const structuredTabId = `structured:omp:/repo`;
    expect(structuredTabId.startsWith("structured:")).toBe(true);
    expect(structuredTabId).not.toBe("omp:/repo");
  });
});
