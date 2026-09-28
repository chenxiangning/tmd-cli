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

/** feature 类细分展示顺序与中文名(仅插排视图用;清单列表仍按大类分节)。 */
export const FEATURE_SUBGROUP_ORDER = ["session", "files", "engine", "web", "ai", "desktop"] as const;
export type FeatureSubgroup = (typeof FEATURE_SUBGROUP_ORDER)[number];
export const FEATURE_SUBGROUP_LABEL: Record<FeatureSubgroup, string> = {
  session: "会话与审批",
  files: "文件与工作区",
  engine: "引擎与远程",
  web: "网络与 Web",
  ai: "智能与提示词",
  desktop: "桌面与辅助",
};
/** feature 插件 id → 细分子组;未登记的新插件落无标签尾块,不猜测。 */
export const FEATURE_SUBGROUP: Record<string, FeatureSubgroup> = {
  "session-budget": "session",
  "session-board": "session",
  "session-search": "session",
  "session-relay": "session",
  "approval-inbox": "session",
  checkpoints: "session",
  workspace: "files",
  files: "files",
  git: "files",
  marks: "files",
  search: "files",
  lsp: "files",
  "cli-config": "engine",
  terminal: "engine",
  ssh: "engine",
  wsl: "engine",
  "network-proxy": "web",
  "web-access": "web",
  assets: "ai",
  "prompt-enhancer": "ai",
  "intent-canvas": "ai",
  "memory-coordinator": "ai",
  wallpaper: "desktop",
  notify: "desktop",
  academy: "desktop",
};
