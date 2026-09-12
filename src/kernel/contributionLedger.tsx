/**
 * 贡献记账 —— 逐插件 attributed ctx:注册调用先记账后透传,撤销时逆序执行。
 *
 * 两条撤销路径共用一个账本:
 * - activate 抛错:该插件全部 undo 逆序执行,半截插件零残留;
 * - 崩溃熔断(pluginQuarantine handler → PluginLifecycle.revoke):同一路径 + 激活表移除。
 *
 * UI 贡献组件在注册期包 PluginBoundary(带 pluginId):挂点/中央 tab/右栏面板/
 * 设置 section/首页面板/市场面板六类渲染面一处包装全覆盖,渲染崩溃即归属计数。
 * grants = null(内置插件)表示能力面不受限;本地插件传 manifest.permissions 集合
 * (events 未授权时 ctx.events 整体拒绝)。
 */
import type { ComponentType, ReactNode } from "react";
import { PluginBoundary } from "./PluginBoundary";
import type { Plugin, PluginContext, PluginEventBus } from "./plugin";
import { removeSettingsSection } from "./settingsRegistry";
import { removeFilePanel } from "./filePanel";
import { removeTabContent } from "./tabs";
import { removeMarketPanel } from "./marketPanel";
import { removeFileVisual } from "./fileVisual";
import { removeHomePanel } from "./homePanels";
import { removeCliConfig } from "./cliConfigRegistry";
import { removeCommand } from "./shortcuts";

/** HostRegistry 拥有的三条撤销通道(经 PluginLifecycle 注入,避免模块环)。 */
export interface ContributionUndo {
  removeCliProfile(id: string): void;
  removeMount(point: PluginContext["contribute"] extends (p: infer P, ...rest: never) => void ? P : never, contribution: Parameters<PluginContext["contribute"]>[1]): void;
  removeSidebarActionById(id: string): void;
}

type Undo = () => void;

const ledgers = new Map<string, Undo[]>();

/** 插件激活期返回的自有资源清理(定时器/监听),并入撤销账本。 */
export function pushCleanup(pluginId: string, cleanup: () => void): void {
  ledgers.get(pluginId)?.push(cleanup);
}

/** 逆序撤销一个插件的全部贡献与清理;单项失败不中断余项(尽力清空)。 */
export function undoContributions(pluginId: string): void {
  const undos = ledgers.get(pluginId);
  if (!undos) return;
  ledgers.delete(pluginId);
  for (let i = undos.length - 1; i >= 0; i--) {
    try {
      undos[i]();
    } catch (e) {
      console.error(`[plugin] 贡献撤销失败(${pluginId}):`, e);
    }
  }
}

/** 激活期授予集:null = 内置插件不受限;数组(可空)= 本地插件按声明受限。 */
export function grantsOf(plugin: Plugin): ReadonlySet<string> | null {
  if (plugin.permissions === undefined) return null;
  return new Set(plugin.permissions);
}
/** UI 组件贡献包一层熔断边界(注册期包一次,组件身份 thereafter 稳定)。 */
function withBoundary<P>(pluginId: string, Comp: ComponentType<P>): ComponentType<P> {
  /* 泛型组件的 JSX spread 在严格模式下无法直接成立,any 化内层再收窄回来。 */
  const Inner = Comp as ComponentType<any>;
  const Wrapped = (props: P): ReactNode => (
    <PluginBoundary pluginId={pluginId}>
      <Inner {...props} />
    </PluginBoundary>
  );
  return Wrapped as ComponentType<P>;
}

function denyEvents(): never {
  throw new Error(`插件缺少权限 "events"(在 manifest.json permissions 声明并重新确认)`);
}

const denyEventsStub: PluginEventBus = {
  on() {
    denyEvents();
  },
  emit() {
    denyEvents();
  },
};

/** 包一层 attributed ctx:register* 先透传后记账;events 按授权门控。 */
export function makeAttributedCtx(
  ctx: PluginContext,
  plugin: Plugin,
  undo: ContributionUndo,
): PluginContext {
  const pluginId = plugin.id;
  const grants = grantsOf(plugin);
  const undos: Undo[] = [];
  ledgers.set(pluginId, undos);
  const track = (fn: Undo): void => {
    undos.push(fn);
  };
  const events = grants === null || grants.has("events") ? ctx.events : denyEventsStub;
  const attributed: PluginContext = {
    events,
    registerCliProfile(profile) {
      ctx.registerCliProfile(profile);
      track(() => undo.removeCliProfile(profile.id));
    },
    contribute(point, contribution) {
      const wrapped = { ...contribution, component: withBoundary(pluginId, contribution.component) };
      ctx.contribute(point, wrapped);
      track(() => undo.removeMount(point, wrapped));
    },
    registerSettingsSection(section) {
      const wrapped = {
        ...section,
        tabs: section.tabs.map((tab) => ({ ...tab, component: withBoundary(pluginId, tab.component) })),
      };
      ctx.registerSettingsSection(wrapped);
      track(() => removeSettingsSection(section.id));
    },
    registerFilePanel(panel) {
      const wrapped = { ...panel, component: withBoundary(pluginId, panel.component) };
      ctx.registerFilePanel(wrapped);
      track(() => removeFilePanel(panel.id));
    },
    registerTabContent(contribution) {
      const wrapped = { ...contribution, component: withBoundary(pluginId, contribution.component) };
      ctx.registerTabContent(wrapped);
      track(() => removeTabContent(contribution.kind));
    },
    registerMarketPanel(panel) {
      const wrapped = { ...panel, component: withBoundary(pluginId, panel.component) };
      ctx.registerMarketPanel(wrapped);
      track(() => removeMarketPanel(panel.pluginId));
    },
    registerSidebarAction(action) {
      ctx.registerSidebarAction(action);
      track(() => undo.removeSidebarActionById(action.id));
    },
    registerFileVisual(provider) {
      ctx.registerFileVisual(provider);
      track(() => removeFileVisual(provider));
    },
    registerCommand(command) {
      ctx.registerCommand(command);
      track(() => removeCommand(command.id));
    },
    registerHomePanel(profileId, panel) {
      ctx.registerHomePanel(profileId, withBoundary(pluginId, panel));
      track(() => removeHomePanel(profileId));
    },
    registerCliConfig(entry) {
      ctx.registerCliConfig(entry);
      track(() => removeCliConfig(entry.id));
    },
  };
  return attributed;
}
