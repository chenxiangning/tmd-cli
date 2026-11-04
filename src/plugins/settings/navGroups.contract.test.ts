/**
 * F-03 设置导航分组契约 —— 组元数据与归并纯逻辑:
 * 7 个导航组唯一且有序;section 按 navGroup 归组、组内保序;
 * 未知/缺省 navGroup 平铺兜底(回滚语义:旧 section 不丢)。
 */

import { describe, expect, it } from "vitest";
import {
  SETTINGS_NAV_GROUPS,
  settingsNavGroup,
  type SettingsSectionContribution,
} from "@kernel/settingsRegistry";
import { groupSettingsSections } from "./navGroups";

const G = SETTINGS_NAV_GROUPS;

describe("F-03 导航组元数据", () => {
  it("恰好 7 个组,order 严格递增", () => {
    expect(G.map((g) => g.id)).toEqual([
      "general",
      "session-workspace",
      "ai-config",
      "remote-access",
      "notify",
      "workbench",
      "system",
    ]);
    const orders = G.map((g) => g.order);
    expect(new Set(orders).size).toBe(orders.length);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it("组标签齐备(词典键,t() 可解析)", () => {
    for (const g of G) {
      expect(g.label.length).toBeGreaterThan(0);
    }
  });

  it("settingsNavGroup 查表:未知/缺省 id 返回 null", () => {
    expect(settingsNavGroup("general")?.id).toBe("general");
    expect(settingsNavGroup("no-such-group")).toBeNull();
    expect(settingsNavGroup(undefined)).toBeNull();
  });
});

describe("F-03 归并纯逻辑", () => {
  const section = (id: string, navGroup?: string, order = 0) =>
    ({ id, title: id, order, navGroup, tabs: [] }) as unknown as SettingsSectionContribution;

  it("section 按组定义序归组,组内保持传入顺序", () => {
    const sections = [
      section("storage", "system", 49),
      section("basic", "general", 0),
      section("assets", "ai-config", 45),
      section("ssh", "remote-access", 40),
    ];
    const entries = groupSettingsSections(sections, G);
    expect(entries.map((e) => e.group?.id)).toEqual(["general", "ai-config", "remote-access", "system"]);
    expect(entries[0].sections.map((s) => s.id)).toEqual(["basic"]);
    expect(entries[3].sections.map((s) => s.id)).toEqual(["storage"]);
  });

  it("空组不渲染组头;未知/缺省 navGroup 平铺兜底不丢 section", () => {
    const entries = groupSettingsSections(
      [section("basic", "general"), section("legacy"), section("unknown-group", "bogus")],
      G,
    );
    expect(entries.map((e) => e.group?.id ?? null)).toEqual(["general", null]);
    expect(entries[0].sections.map((s) => s.id)).toEqual(["basic"]);
    expect(entries[1].sections.map((s) => s.id)).toEqual(["legacy", "unknown-group"]);
  });

  it("全量 section 无一遗漏(归并前后 id 多重集相等)", () => {
    const all = [
      section("basic", "general"), section("wallpaper", "general"),
      section("workspace-groups", "session-workspace"),
      section("cli-config", "ai-config"), section("assets", "ai-config"),
      section("web-access", "remote-access"), section("ssh", "remote-access"),
      section("notify", "notify"), section("workbench", "workbench"),
      section("storage", "system"), section("extensions", "system"), section("intent-canvas", "system"),
    ];
    const entries = groupSettingsSections(all, G);
    expect(entries).toHaveLength(7);
    expect(entries.flatMap((e) => e.sections.map((s) => s.id)).sort()).toEqual(
      all.map((s) => s.id).sort(),
    );
  });
});
