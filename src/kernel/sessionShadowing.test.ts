/**
 * 影子会话登记契约测试:会话表合流点滤除、幂等恢复、转正解除。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearShadowSessionsForTest,
  filterShadowSessions,
  isShadowedSession,
  markShadowSession,
  restoreShadowSessions,
  unmarkShadowSession,
} from "./sessionShadowing";

beforeEach(() => {
  clearShadowSessionsForTest();
});

describe("sessionShadowing 影子会话登记", () => {
  it("mark 后被会话表过滤滤除,unmark 后恢复", () => {
    const list = [{ id: "a" }, { id: "b" }];
    expect(filterShadowSessions(list)).toEqual(list);
    markShadowSession("a");
    expect(isShadowedSession("a")).toBe(true);
    expect(filterShadowSessions(list)).toEqual([{ id: "b" }]);
    unmarkShadowSession("a");
    expect(filterShadowSessions(list)).toEqual(list);
  });

  it("unmark 未知 id 幂等", () => {
    expect(() => unmarkShadowSession("ghost")).not.toThrow();
  });

  it("restoreShadowSessions 幂等:重复调用不放大集合(storage 缺失环境回落内存集合)", () => {
    markShadowSession("s1");
    const first = restoreShadowSessions();
    expect(first).toContain("s1");
    const second = restoreShadowSessions();
    expect(second).toContain("s1");
    expect(second.filter((id) => id === "s1")).toHaveLength(1);
  });

  it("恢复的影子 id 同样被过滤(跨重载语义:恢复即隔离)", () => {
    restoreShadowSessions();
    markShadowSession("reloaded");
    expect(filterShadowSessions([{ id: "reloaded" }, { id: "normal" }])).toEqual([
      { id: "normal" },
    ]);
  });
});
