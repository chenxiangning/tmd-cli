/**
 * 插件契约 —— tmd-cli 的铁律载体：一切能力皆插件，内核只做宿主。
 *
 * 插件生命周期：register → activate(ctx) → [deactivate]。
 * 插件之间不直接依赖，全部通过 ctx 暴露的注册点协作。
 */

import type { ComponentType } from "react";
import type { EventBus } from "./events";
import type { CliProfile } from "./cli";
import type { SettingsSectionContribution } from "./settingsRegistry";
/** 插件分类 —— 插件市场按类分排;"core" 同时意味着焊死(不可拔出)。 */
export type PluginCategory = "engine" | "feature" | "core";

/** 插件展示元数据 —— 插件市场(插排页)消费,与激活逻辑无关。 */
export interface PluginMeta {
  /** 显示名,如 "Claude Code"。 */
  name: string;
  /** 一句话能力描述,市场页卡片用。 */
  desc: string;
  /** 插头/卡片的 monogram 缩写(≤2 字符),如 "CC"。icon 缺省时的兜底。 */
  abbr: string;
  /** 插头/卡片徽标组件(CLI 品牌字形或 lucide 语义图标),调用方必传 size;缺省回退 abbr。 */
  icon?: ComponentType<{ size: number }>;
  /** 徽标颜色(CSS color),施加在容器上经 currentColor 传导;缺省跟随主题 accent。 */
  iconColor?: string;
  /** 分类:插排页分排依据;"core" = 焊死不可拔。 */
  category: PluginCategory;
}

/** 外壳暴露的挂载点（第五轮决策：头/底工具栏为扩展预留）。 */
export type MountPoint =
  | "header.left"
  | "header.right"
  /** 头部面包屑/工作区-会话导航区。 */
  | "header.breadcrumb"
  | "footer.left"
  | "footer.right"
  | "leftSidebar.section"
  /** 工作区标题行右侧动作区:贡献 icon 按钮级组件(如 session-budget 的预算入口)。 */
  | "leftSidebar.workspaceCaption"
  | "leftRail"
  | "rightRail"
  | "overlay"
  /** 中央幕布的无会话首页(welcome/引导页);无活跃 session 时整页渲染。 */
  | "editorCenter.welcome"
  /** 中央编辑区标签内容 —— 每个 tab 一个组件,按 tabId 取对应内容。 */
  | "editorCenter.tabContent"
  /** 幕布下方富 composer 输入区。 */
  | "editorCenter.composer"
  /** composer 底部状态条(+ 模型/能力/发送)。 */
  | "composer.statusBar";

export interface MountContribution {
  /** 同挂载点内排序，小的在前。 */
  order?: number;
  component: ComponentType;
}

/** 插件激活时拿到的宿主上下文。这是插件能触达的全部世界。 */
export interface PluginContext {
  /** 注册一个 CLI profile（cli-* 插件专用）。 */
  registerCliProfile(profile: CliProfile): void;
  /** 向外壳挂载点贡献 UI。 */
  contribute(point: MountPoint, contribution: MountContribution): void;
  /** 注册一个设置 section(设置面板左侧导航项 + 右侧 tab 内容)。 */
  registerSettingsSection(section: SettingsSectionContribution): void;
  /** 内核事件总线（跨插件通信唯一通道）。 */
  events: EventBus;
}

export interface Plugin {
  /** 全局唯一 id，约定 `cli-omp` / `files` / `git` 风格。 */
  readonly id: string;
  /** 展示元数据(插件市场渲染来源)。 */
  readonly meta: PluginMeta;
  /** 依赖的其它插件 id，内核保证先激活依赖。 */
  readonly dependsOn?: readonly string[];
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void;
}
