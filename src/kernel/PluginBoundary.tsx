/**
 * 插件贡献渲染边界 —— 渲染抛错只塌该贡献位,崩溃按插件归属计数。
 * 贡献组件在注册期(contributionLedger)统一包裹本边界:挂点/中央 tab/
 * 右栏面板/设置 section/首页面板/市场面板六类渲染面一处包装全覆盖。
 */
import { Component, type ReactNode } from "react";
import { recordPluginCrash } from "./pluginQuarantine";

interface Props {
  pluginId: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class PluginBoundary extends Component<Props, State> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[plugin] 贡献组件渲染失败(${this.props.pluginId}):`, error);
    recordPluginCrash(this.props.pluginId, reason);
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}
