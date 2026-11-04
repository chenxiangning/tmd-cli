/**
 * local-loader —— 本地插件管理插件(内置)。
 * 插排页「本地插件」分区 UI 经 market.local 挂点贡献;装载/信任/版本编排全在 kernel/localPlugins,
 * 本插件零业务知识,只负责把管理 UI 挂上插排(kernel 不染 UI 规则)。
 * 设置入口只打开 app-shell 的 shell.openMarket 命令,不反向 import 外壳。
 */
import { PlugsConnected } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { Plugin } from "@kernel/plugin";
import { LocalPluginsSection } from "./LocalSection";
import { ExtensionsSettingsTab } from "./ExtensionsSettingsTab";
import "./locales"; /* 域词典随插件自带:import 即注册 */

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
    ctx.registerSettingsSection({
      id: "extensions",
      title: t("插件与扩展"),
      description: t("管理内置插件启停与 ~/.tmd-cli/plugins/ 本地插件。"),
      icon: <PlugsConnected size="0.875rem" aria-hidden />,
      order: 44,
      navGroup: "system",
      tabs: [
        {
          id: "extensions",
          title: t("插件与扩展管理"),
          order: 0,
          component: ExtensionsSettingsTab,
        },
      ],
    });
  },
};
