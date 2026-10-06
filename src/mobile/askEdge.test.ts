/**
 * ask 事件化沿检测回归(2026-10-06):collectIdleEdges 维护 turnActive 快照,
 * 只在 true→false 下降拍产出会话(ask 首现必伴随活动翻 idle)。首见、上升沿、
 * 重复下降不触发;消失会话清账。
 */

import { describe, expect, it } from "vitest";
import { collectIdleEdges } from "./shared";
import type { RemoteSession } from "./remote";

function session(id: string, turnActive?: boolean): RemoteSession {
  return { id, profileId: "omp", cwd: "/w", activity: { turnActive } };
}

describe("collectIdleEdges", () => {
  it("首见不触发(无沿可比)", () => {
    const prev = new Map<string, boolean>();
    expect(collectIdleEdges(prev, [session("a", true), session("b")])).toEqual([]);
    expect(prev.get("a")).toBe(true);
    expect(prev.get("b")).toBe(false);
  });

  it("true→false 下降沿触发;false→true 上升沿不触发", () => {
    const prev = new Map<string, boolean>([["a", true], ["b", false]]);
    const edges = collectIdleEdges(prev, [session("a", false), session("b", true)]);
    expect(edges.map((s) => s.id)).toEqual(["a"]);
  });

  it("持平不触发;连续下降只触发一次", () => {
    const prev = new Map<string, boolean>([["a", false]]);
    expect(collectIdleEdges(prev, [session("a", false)])).toEqual([]);
    const step1 = new Map<string, boolean>([["a", true]]);
    expect(collectIdleEdges(step1, [session("a", false)]).map((s) => s.id)).toEqual(["a"]);
    expect(collectIdleEdges(step1, [session("a", false)])).toEqual([]);
  });

  it("activity 缺省视作 false(翻空闲沿仍成立)", () => {
    const prev = new Map<string, boolean>([["a", true]]);
    expect(collectIdleEdges(prev, [{ id: "a", profileId: "omp", cwd: "/w" }]).map((s) => s.id)).toEqual(["a"]);
  });

  it("消失会话清账,重现视作首见", () => {
    const prev = new Map<string, boolean>([["a", true], ["gone", true]]);
    collectIdleEdges(prev, [session("a", true)]);
    expect(prev.has("gone")).toBe(false);
    expect(collectIdleEdges(prev, [session("gone", false)])).toEqual([]);
  });
});
