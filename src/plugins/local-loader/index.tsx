/**
 * local-loader —— 本地插件管理插件(内置)。
 * 插排页「本地插件」分区 UI 经 market.local 挂点贡献;装载/信任/版本编排全在 kernel/localPlugins,
 * 本插件零业务知识,只负责把管理 UI 挂上插排(kernel 不染 UI 规则)。
 */
import { LocalPluginsSection } from "./LocalSection";
import type { Plugin } from "@kernel/plugin";

export const localLoaderPlugin: Plugin = {
  id: "local-loader",
  meta: {
    name: "本地插件",
    abbr: "LP",
    desc: "管理 ~/.tmd-cli/plugins/ 本地插件:对话造插件、免重启装载、版本回退",
    category: "local",
  },
  activate(ctx) {
    ctx.contribute("market.local", { component: LocalPluginsSection });
  },
};
