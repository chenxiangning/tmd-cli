// 插件市场分类常量(展示顺序 + 中文名),自 PluginMarketStrip.tsx 拆出:
// 组件文件只导组件,Fast Refresh 才能安全保留组件状态。
import type { PluginCategory } from "@kernel/plugin";

/** 分类展示顺序与中文名(插排分排 + 清单分节共用)。 */
export const CATEGORY_LABEL: Record<PluginCategory, string> = {
  engine: "CLI 引擎",
  feature: "界面功能",
  core: "核心系统",
  local: "本机插件",
};
export const CATEGORY_ORDER: readonly PluginCategory[] = ["engine", "feature", "core", "local"];
