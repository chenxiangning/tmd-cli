/**
 * drawerPlugins 单测 —— 插件分区 = 启用 ∩ feature 类;面板命中 → panelId + 面板图标,
 * 未命中 → 打开设置兜底。纯函数,不碰 host。
 */
import { describe, expect, it } from "vitest";
import { pluginDrawerItems } from "./drawerItems";

function state(id: string, category: string, enabled = true) {
  return { plugin: { id, meta: { name: id, desc: `${id} 描述`, category } }, enabled };
}

describe("pluginDrawerItems", () => {
  it("只保留启用且 feature 类的插件;engine/core 一律不进抽屉", () => {
    const items = pluginDrawerItems(
      [
        state("git", "feature"),
        state("files", "feature", false), // 禁用
        state("cli-omp", "engine"),
        state("composer", "core"),
      ],
      [],
    );
    expect(items.map((i) => i.name)).toEqual(["git"]);
  });

  it("命中右栏面板:panelId/iconNode 就位,不走设置兜底", () => {
    const FakeIcon = () => null;
    const items = pluginDrawerItems([state("git", "feature")], [{ id: "git", icon: FakeIcon }]);
    expect(items[0].panelId).toBe("git");
    expect(items[0].iconNode).toBe(FakeIcon);
    expect(items[0].openSettings).toBe(false);
    expect(items[0].action).toBe("open");
  });

  it("无面板的 feature 插件:openSettings 兜底,无 panelId", () => {
    const items = pluginDrawerItems([state("workspace", "feature")], [{ id: "git", icon: () => null }]);
    expect(items[0].panelId).toBeUndefined();
    expect(items[0].openSettings).toBe(true);
  });
});
