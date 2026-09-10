/**
 * 插件市场二级面板注册表 —— 引擎插头角标入口 + 滑出面板内容。
 *
 * 语义:某个插件(如 cli-omp)想在自己的插头上提供「二级市场」(管理该 CLI
 * 自己的扩展/插件),经 activate(ctx) 的 ctx.registerMarketPanel 登记;
 * app-shell 插排发现插头有面板即渲染角标,点击滑出,壳只管开合,内容全部
 * 由插件贡献 —— CLI 私有语义(目录源/安装命令/风险文案)不进 kernel/shell。
 *
 * 自驱动注册表(对齐 filePanel/tabs 惯例):不经 HostRegistry,Host 纯委托,
 * 消费方(app-shell)直接 import 查询函数。
 */

import type { ComponentType } from "react";

/** 插件注册的二级市场面板。 */
export interface MarketPanelContribution {
  /** 归属插件 id(如 "cli-omp");角标只渲染在对应插头上。 */
  pluginId: string;
  /** 角标图标(@phosphor-icons-react 语义图标),调用方必传 size。 */
  icon: ComponentType<{ size: number | string }>;
  /** 角标 hover 提示 + 面板标题。 */
  title: string;
  /** 面板内容组件;壳持有开合,关闭经 onClose 回传。 */
  component: ComponentType<{ onClose: () => void }>;
}

const panels = new Map<string, MarketPanelContribution>();

/** 注册二级市场面板(插件 activate 内调用)。重复 pluginId 抛错,与 registerCliProfile 同纪律。 */
export function registerMarketPanel(panel: MarketPanelContribution): void {
  if (panels.has(panel.pluginId)) {
    throw new Error(`插件市场二级面板重复注册: ${panel.pluginId}`);
  }
  panels.set(panel.pluginId, panel);
}

/** 撤销通道(激活失败回滚/熔断摘除):pluginId 未注册时静默(幂等)。 */
export function removeMarketPanel(pluginId: string): void {
  panels.delete(pluginId);
}

/** 查询某插头的二级市场面板;未注册返回 undefined(插头不渲染角标)。 */
export function getMarketPanel(
  pluginId: string,
): MarketPanelContribution | undefined {
  return panels.get(pluginId);
}
