/**
 * 活会话列表比较器行为契约测试。
 * 契约:完成未读置顶;其余按 spawn 时间(createdAt)倒序 —— 排序键必须是稳定身份,
 * 两个同时流式输出的会话绝不因输出先后互换位置(会话列表抖动事故的回归防线)。
 */
import { describe, expect, it } from "vitest";
import { compareLiveSessions } from "./utils";
import type { SessionMeta } from "@kernel/ipc";

const meta = (id: string, createdAt?: number): SessionMeta => ({
  id,
  profileId: "omp",
  cwd: "/repo",
  createdAt,
});

describe("compareLiveSessions", () => {
  it("完成未读的会话置顶,与活动时间无关", () => {
    const old = meta("old", 100);
    const freshUnread = meta("fresh", 900);
    const sorted = [old, freshUnread].sort((a, b) =>
      compareLiveSessions(a, b, (id) => id === "fresh"),
    );
    expect(sorted.map((s) => s.id)).toEqual(["fresh", "old"]);
  });

  it("已读会话严格按 spawn 时间倒序:输出交错不得改变相对位置(抖动回归防线)", () => {
    const a = meta("a", 100);
    const b = meta("b", 200);
    const sorted = [a, b].sort((x, y) =>
      compareLiveSessions(x, y, () => false),
    );
    /* 修复前排序键是 lastActivityAt(输出交错即互换);修复后比较器根本不接收
       活动时间 —— 无论输出时间线如何,b(更新)恒在 a 之上 */
    expect(sorted.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("createdAt 缺失按 0 沉底;同毫秒以 id 倒序 tie-break,跨渲染确定", () => {
    const legacy = meta("legacy", undefined);
    const z = meta("z", 100);
    const a = meta("a", 100);
    const sorted = [legacy, z, a].sort((x, y) =>
      compareLiveSessions(x, y, () => false),
    );
    expect(sorted.map((s) => s.id)).toEqual(["z", "a", "legacy"]);
  });
});
