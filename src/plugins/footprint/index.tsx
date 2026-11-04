/**
 * footprint —— C-02 迁移期兼容壳(本体已迁 workbench/review/footprint)。
 *
 * 每日足迹现为「回顾 → 每日足迹」二级视图:本插件只保留左 rail 入口
 * (openFootprintTab 经 ./fpTab 兼容层直达回顾宿主);旧 footprint.daily kind
 * 由 workbench 注册兼容渲染历史 tab;写侧订阅在 B-02 已迁 review/footprintRuntime。
 * C-04 随旧插件目录一并退役(数据路径 ~/.tmd-cli/footprint/ 零迁移)。
 */
import { Footprints } from "@phosphor-icons/react";
import type { Plugin, PluginContext } from "@kernel/plugin";
import { openFootprintTab } from "./fpTab";

export const footprintPlugin: Plugin = {
  id: "footprint",
  meta: {
    name: "每日工作足迹",
    abbr: "足迹",
    desc: "月历热力 + 功能卡流 + 证据抽屉:反查任意一天做了什么",
    icon: Footprints,
    iconColor: "#4f8dff",
    category: "feature",
  },
  activate(ctx: PluginContext) {
    /* 左 rail 入口(排序 46:动画 45 之后);onSelect 直达「回顾 → 每日足迹」。 */
    ctx.registerSidebarAction({
      id: "footprint",
      label: "每日足迹",
      icon: Footprints,
      order: 46,
      leftRail: true,
      active: () => false,
      onSelect: () => openFootprintTab(),
    });
    /* 旧 kind 兼容渲染由 workbench 承担(workbench/index activate);
     * 写侧订阅在 review/footprintRuntime(B-02);本插件不再持有任何装配。 */
  },
};
