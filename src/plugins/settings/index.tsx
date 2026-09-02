/**
 * settings 插件 —— 设置面板本体 + 「基础设置」section。
 *
 * 两部分职责:
 * 1. contribute("overlay") → SettingsPanel 全屏面板壳(渲染注册表内容)。
 * 2. registerSettingsSection → 基础设置/外观 tab(主题模式 + preset 网格)。
 *
 * 后续其它设置域(CLI 配置/快捷键/项目管理)由各自插件注册新 section,
 * 本文件不需要改动 —— 设置面板是注册表驱动的开放结构。
 */

import { Keyboard, Monitor, Settings } from "lucide-react";
import type { Plugin } from "@kernel/plugin";
import { SettingsPanel } from "./SettingsPanel";
import { BasicAppearanceTab } from "./BasicAppearanceTab";
import { BehaviorTab } from "./BehaviorTab";

export const settingsPlugin: Plugin = {
  id: "settings",
  meta: { name: "设置", abbr: "ST", desc: "设置面板与主题/行为配置", core: true },
  activate(ctx) {
    ctx.contribute("overlay", { order: 0, component: SettingsPanel });
    ctx.registerSettingsSection({
      id: "basic",
      title: "基础设置",
      description: "外观、行为和环境的基础配置。",
      icon: <Settings size={14} aria-hidden />,
      order: 0,
      tabs: [
        {
          id: "appearance",
          title: "外观",
          icon: <Monitor size={14} aria-hidden />,
          order: 0,
          component: BasicAppearanceTab,
        },
        {
          id: "behavior",
          title: "行为",
          icon: <Keyboard size={14} aria-hidden />,
          order: 1,
          component: BehaviorTab,
        },
      ],
    });
  },
};
