/**
 * `tmd-sdk` 虚拟模块的实体 —— 本地(外部)插件 bundle 的唯一合法内核 import 面。
 * 基础原语(react/react-dom/jsx-runtime)boot 期一次装配;tmd-sdk 逐插件装配
 * (installPluginSdkShim):ipc/settings/host 按该插件 manifest.permissions 包装,
 * 未声明 permissions = 纯 UI 插件(三个能力门面访问即抛明确错误)。
 * 注册面仍只经 activate(ctx) 的 PluginContext —— 与内置插件完全同规则,不开旁路。
 * 收窄原则:SDK 越窄,内核 API 演进时的兼容债越少;复杂能力请走仓内置候选路径。
 */
import * as React from "react";
import * as ReactDOM from "react-dom";
import { Fragment, createElement } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { wrapHost, wrapIpc, wrapSettings } from "./pluginPermissions";

declare global {
  interface Window {
    /** boot 早期安装的 shim 实例表(localPluginLoad.shimUrl 按此生成 blob 模块)。 */
    __TMD_SHIMS?: Record<string, Record<string, unknown>>;
  }
}

/**
 * boot 早期同步安装一次(main.tsx useEffect 首行):任何本地插件 import 发生之前必须就位。
 * tmd-sdk 不在此表 —— 它按插件权限逐个装配(见 installPluginSdkShim)。
 */
export function installPluginShims(): void {
  window.__TMD_SHIMS = {
    react: React as unknown as Record<string, unknown>,
    "react-dom": ReactDOM as unknown as Record<string, unknown>,
    "react/jsx-runtime": { jsx, jsxs, Fragment },
  };
}
/** 逐插件装配 tmd-sdk 实例(key = localPluginLoad.sdkShimKey,装载前一刻调用)。
 *  node 测试环境无 window(importBundle 被 mock):装配是浏览器专属,静默跳过。 */
export function installPluginSdkShim(key: string, permissions: readonly string[]): void {
  if (typeof window === "undefined") return;
  const grants = new Set(permissions);
  window.__TMD_SHIMS![key] = {
    createElement,
    Fragment,
    ipc: wrapIpc(grants),
    settings: wrapSettings(grants),
    host: wrapHost(grants),
  };
}
