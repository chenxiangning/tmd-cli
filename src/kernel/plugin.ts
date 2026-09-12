/**
 * 插件契约 —— tmd-cli 的铁律载体：一切能力皆插件，内核只做宿主。
 *
 * 插件生命周期：register → activate(ctx) → [deactivate]。
 * 插件之间不直接依赖，全部通过 ctx 暴露的注册点协作。
 */

import type { ComponentType } from "react";
import type { CliProfile } from "./cli";
import type { SettingsSectionContribution } from "./settingsRegistry";
import type { FilePanelContribution } from "./filePanel";
import type { TabContentContribution } from "./tabs";
import type { MarketPanelContribution } from "./marketPanel";
import type { CommandContribution } from "./shortcuts";
import type { FileVisualProvider } from "./fileVisual";
import type { SidebarAction } from "./sidebarActions";
import type { CliConfigEntry } from "./cliConfigRegistry";
/**
 * 本地插件能力类别(manifest.permissions 合法值)。
 * 无 permissions 字段 = 纯 UI 插件:只有 React 原语与 ctx 注册面,ipc/host/settings 整体缺席。
 * 威胁模型边界:JS 层包装是「劝阻」不是「围栏」—— 同域 bundle 可蓄意绕过;
 * 真围栏(Rust 侧命令级插件身份)是 v2 议题,见 openspec/changes/plugin-hardening。
 */
export const PLUGIN_PERMISSIONS = [
  "ipc.terminal",
  "ipc.exec",
  "ipc.fs.read",
  "ipc.fs.write",
  "ipc.config",
  "ipc.git",
  "ipc.checkpoints",
  "ipc.net",
  "ipc.sql",
  "ipc.ssh",
  "ipc.util",
  "settings.read",
  "settings.write",
  "host",
  "events",
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

export type PluginCategory = "engine" | "feature" | "core" | "local";

/** 插件展示元数据 —— 插件市场(插排页)消费,与激活逻辑无关。 */
export interface PluginMeta {
  /** 显示名,如 "Claude Code"。 */
  name: string;
  /** 一句话能力描述,市场页卡片用。 */
  desc: string;
  /** 插头/卡片的 monogram 缩写(≤2 字符),如 "CC"。icon 缺省时的兜底。 */
  abbr: string;
  /** 插头/卡片徽标组件(CLI 品牌字形或 @phosphor-icons-react 语义图标),调用方必传 size;缺省回退 abbr。 */
  icon?: ComponentType<{ size: number | string }>;
  /** 徽标颜色(CSS color),施加在容器上经 currentColor 传导;缺省跟随主题 accent。 */
  iconColor?: string;
  /** 分类:插排页分排依据;"core" = 焊死不可拔。 */
  category: PluginCategory;
}

/**
 * 挂载点 union(插件经 ctx.contribute 贡献 UI 的合法位置;
 *  僵尸声明一经发现即删(曾清理 footer.left/right、leftRail/rightRail)。 */
export type MountPoint =
  | "header.left"
  | "header.right"
  /** 头部左区按钮簇(折叠左栏/插件市场/回到首页所在 titlebar 左区,按钮列尾追加)。 */
  | "header.leftCluster"
  /** 头部中区:会话标题 tab 条与编辑 tab 条。 */
  | "header.breadcrumb"
  | "leftSidebar.section"
  /** 工作区标题行右侧动作区:贡献 icon 按钮级组件(如 session-budget 的预算入口)。 */
  | "leftSidebar.workspaceCaption"
  /** 工作区「新建会话」菜单组末尾:贡献新会话入口行(如 ssh 插件的「SSH 连接」)。 */
  | "workspace.newSessionMenu"
  | "overlay"
  /** 中央幕布的无会话首页(welcome/引导页);无活跃 session 时整页渲染。 */
  | "editorCenter.welcome"
  /** welcome 首页尾部(引擎列表/页脚之后):跨引擎的整页级面板(如 WSL 主机卡)。 */
  | "welcome.footer"
  /** 幕布下方富 composer 输入区。 */
  | "editorCenter.composer"
  /** composer 输入区右缘竖向图标列(assets 唤醒入口等)。 */
  | "composer.inputRail"
  /** composer 底部状态条(+ 模型/能力/发送)。 */
  | "composer.statusBar"
  /** 插件市场页「本地插件」分区(管理 UI 归 local-loader 插件贡献,kernel 不染业务)。 */
  | "market.local";

export interface MountContribution {
  /** 同挂载点内排序，小的在前。 */
  order?: number;
  component: ComponentType;
}

/** 插件激活时拿到的宿主上下文。这是插件能触达的全部注册面 ——
 *  一切贡献点(挂点/CLI profile/设置/右栏面板/tab 内容/侧栏动作/文件视觉)都经
 *  ctx 登记,不存在旁路注册表;运行时能力(host/ipc/settings 等模块)仍可直接 import。 */
export interface PluginContext {
  /** 注册一个 CLI profile（cli-* 插件专用）。 */
  registerCliProfile(profile: CliProfile): void;
  /** 向外壳挂载点贡献 UI。 */
  contribute(point: MountPoint, contribution: MountContribution): void;
  /** 注册一个设置 section(设置面板左侧导航项 + 右侧 tab 内容)。 */
  registerSettingsSection(section: SettingsSectionContribution): void;
  /** 注册右栏面板(filePanel 注册表的 ctx 通道)。 */
  registerFilePanel(panel: FilePanelContribution): void;
  /** 注册中央编辑区某 kind 的 tab 内容组件(tabs 路由注册表的 ctx 通道)。 */
  registerTabContent(contribution: TabContentContribution): void;
  /** 注册插件市场二级面板(插头角标 + 滑出面板,内容由插件贡献;marketPanel 注册表)。 */
  registerMarketPanel(panel: MarketPanelContribution): void;
  /** 注册侧栏快捷动作(图标 + 点击回调,渲染归 app-shell 侧栏)。 */
  registerSidebarAction(action: SidebarAction): void;
  /** 注册文件视觉 provider(fileVisual 注册表的 ctx 通道)。 */
  registerFileVisual(provider: FileVisualProvider): void;
  /** 注册一条快捷键命令(shortcuts 注册表的 ctx 通道;键位语义归插件,内核只做分发)。 */
  registerCommand(command: CommandContribution): void;
  /** 注册首页引擎卡下方专属面板(homePanels 注册表的 ctx 通道,键 = CliProfile.id)。 */
  registerHomePanel(profileId: string, panel: ComponentType): void;
  /** 注册一份引擎的图形化配置面(cliConfigRegistry 的 ctx 通道;渲染归 cli-config 插件)。 */
  registerCliConfig(entry: CliConfigEntry): void;
  /** 内核事件总线（跨插件通信唯一通道）。 */
  events: PluginEventBus;
}

/** 事件总线结构面(EventBus 按此结构满足;本地插件 events 未授权时以同形拒绝桩顶替)。 */
export interface PluginEventBus {
  on<T>(topic: string, handler: (payload: T) => void): () => void;
  emit<T>(topic: string, payload: T): void;
}

export interface Plugin {
  /** 全局唯一 id，约定 `cli-omp` / `files` / `git` 风格。 */
  readonly id: string;
  /** 展示元数据(插件市场渲染来源)。 */
  readonly meta: PluginMeta;
  /** 依赖的其它插件 id，内核保证先激活依赖。 */
  readonly dependsOn?: readonly string[];
  /** 能力授权集(本地插件由 manifest.permissions 合成;缺省 = 内置插件不受限)。
   *  空数组 = 纯 UI 插件:仅 React 原语与注册面,ipc/host/settings/events 全拒。 */
  readonly permissions?: readonly string[];
  activate(ctx: PluginContext): void | Promise<void> | (() => void);
  deactivate?(): void;
}
