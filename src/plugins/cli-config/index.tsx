/**
 * cli-config 插件 —— 设置面板「CLI 独立配置」section。
 *
 * 聚合渲染:各 cli-* 插件经 ctx.registerCliConfig 贡献引擎配置面
 * (schema + load/save 纯函数),本插件只提供引擎子 tab、通用表单、
 * 复合控件、原始编辑与 IO 壳 —— 不含任何 CLI 私有格式知识。
 */

import { GearSix } from "@phosphor-icons/react";
import type { Plugin } from "@kernel/plugin";
import { t } from "@kernel/i18n";
import { CliConfigTab } from "./CliConfigTab";
export const cliConfigPlugin: Plugin = {
  id: "cli-config",
  meta: {
    name: "CLI 配置",
    abbr: "CC",
    desc: "图形化编辑各 CLI 的本地配置文件",
    icon: GearSix,
    iconColor: "#7C6FDB",
    category: "feature",
  },
  activate(ctx) {
    ctx.registerSettingsSection({
      id: "cli-config",
      title: t("CLI 独立配置"),
      description: t(
        "图形化编辑各 CLI 的本地配置文件 —— 不用记命令、不用手改磁盘文件;保存即写回原文件,未知内容原样保留。",
      ),
      icon: <GearSix size="0.875rem" aria-hidden />,
      order: 3,
      tabs: [{ id: "engines", title: t("引擎"), component: CliConfigTab }],
    });
  },
};
