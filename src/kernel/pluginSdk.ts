/**
 * `tmd-sdk` 虚拟模块的实体 —— 本地(外部)插件 bundle 的唯一合法内核 import 面。
 * 按现行规则只暴露「运行时能力模块」(ipc / settings / host 查询门面)+ React 原语,
 * 注册面仍只经 `activate(ctx)` 的 PluginContext —— 与内置插件完全同规则,不开旁路。
 * 收窄原则:SDK 越窄,内核 API 演进时的兼容债越少;复杂能力请走仓内置候选路径。
 */
import * as React from "react";
import * as ReactDOM from "react-dom";
import { Fragment, createElement } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import * as host from "./host";
import * as ipc from "./ipc";
import * as settings from "./settings";

export { createElement, Fragment } from "react";
export * as ipc from "./ipc";
export * as settings from "./settings";
export * as host from "./host";

declare global {
  interface Window {
    /** boot 早期安装的 shim 实例表(localPluginLoad.shimUrl 按此生成 blob 模块)。 */
    __TMD_SHIMS?: Record<string, Record<string, unknown>>;
  }
}

/**
 * boot 早期同步安装一次(main.tsx useEffect 首行):任何本地插件 import 发生之前必须就位。
 * key = 插件 bundle 里合法的裸 specifier 白名单(localPluginLoad.SHIM_SPECIFIERS)。
 */
export function installPluginShims(): void {
  window.__TMD_SHIMS = {
    react: React as unknown as Record<string, unknown>,
    "react-dom": ReactDOM as unknown as Record<string, unknown>,
    "react/jsx-runtime": { jsx, jsxs, Fragment },
    "tmd-sdk": {
      createElement,
      Fragment,
      ipc,
      settings,
      host,
    },
  };
}
