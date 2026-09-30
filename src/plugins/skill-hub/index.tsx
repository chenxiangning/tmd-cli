/**
 * skill-hub 插件入口 ── 跨引擎技能目录管理 + 技能商店。
 *
 * 贡献面(双贡献先例 memory-coordinator):
 * - 右栏 Skills 概览面板(filePanel,轻量:每引擎一行 + 打开管理)
 * - 中央 Skills 管理 tab(tabContent,kind="skill-hub",单例)
 *
 * 存储:直接管理各家 CLI 自己的 skill 目录(真相源唯一,tmd 不建第二套);
 * 安装走 netDownload/skillExtract 原子命令(见 install.ts)。
 */

import { PuzzlePiece } from "@phosphor-icons/react";
import type { Plugin } from "@kernel/plugin";
import { SkillHubPanel } from "./SkillHubPanel";
import { SkillHubTab } from "./SkillHubTab";
import { openSkillHubTab, SKILL_HUB_TAB_KIND } from "./hubTab";
import { DecorIcon } from "@kernel/iconSet";
import "./locales"; /* 域词典随插件自带:i18n.registerMessages(import 即注册) */

export const skillHubPlugin: Plugin = {
  id: "skill-hub",
  meta: {
    name: "技能中心",
    abbr: "SK",
    desc: "跨引擎技能目录管理:十家扫描/预览/删除 + 技能商店安装落位",
    icon: PuzzlePiece,
    iconColor: "#4FB286",
    category: "feature",
  },
  activate(ctx) {
    ctx.registerFilePanel({
      id: "skill-hub",
      label: "Skills",
      icon: PuzzlePiece,
      component: SkillHubPanel,
      showFileSubbar: false,
      order: 32, /* 能力生态组次席(memory/skills/mcp 钉 rail 底簇,与 ⋯ 呼应) */
      railGroup: "ecosystem",
      railBottom: true,
      centerTab: { open: openSkillHubTab },
    });
    ctx.registerTabContent({
      kind: SKILL_HUB_TAB_KIND,
      component: SkillHubTab,
      icon: (p) => <DecorIcon id="panel-skill-hub" Fallback={PuzzlePiece} {...p} />,
    });
  },
};
