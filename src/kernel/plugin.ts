/**
 * 插件契约 —— tmd-cli 的铁律载体：一切能力皆插件，内核只做宿主。
 *
 * 插件生命周期：register → activate(ctx) → [deactivate]。
 * 插件之间不直接依赖，全部通过 ctx 暴露的注册点协作。
 */

import type { ComponentType } from "react";
import type { EventBus } from "./events";
import type { CliProfile } from "./cli";

export type MountPoint =
  | "header.left"
  | "header.right"
  | "footer.left"
  | "footer.right"
  | "leftSidebar.section"
  | "rightSidebar.tab"
  | "leftRail"
  | "rightRail"
  | "overlay"
  /** 中央编辑区标签页栏 —— 文件预览/编辑器等在此开 tab,不弹窗。 */
  | "editorCenter.tabBar"
  /** 中央编辑区标签内容 —— 每个 tab 一个组件,按 tabId 取对应内容。 */
  | "editorCenter.tabContent"
  /** 幕布下方富 composer 输入区。 */
  | "editorCenter.composer";

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
  /** 内核事件总线（跨插件通信唯一通道）。 */
  events: EventBus;
}

export interface Plugin {
  /** 全局唯一 id，约定 `cli-omp` / `files` / `git` 风格。 */
  readonly id: string;
  /** 依赖的其它插件 id，内核保证先激活依赖。 */
  readonly dependsOn?: readonly string[];
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void;
}
