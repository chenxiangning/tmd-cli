/**
 * network-proxy 插件 —— 网络代理开关浮层(独立插头,插件市场可插拔)。
 *
 * - 职责:「网络代理」浮层(滑动块启用开关 + 代理地址,校验/归一见 proxyCommit);
 *   经 overlay 挂点常驻(关闭态渲染 null),portal 挂 body。
 * - 入口:侧栏齿轮菜单/底栏钉住的「网络代理」按钮 —— 本插件 activate 时经
 *   kernel/sidebarActions 注册表自注册(标签/图标/激活态/回调),壳只渲染
 *   注册表,互不引用。
 * - 生效在 Rust proxy.rs(进程 env 注入):客户端联网 + 之后 spawn 的 CLI 子进程。
 *   拔出插件 = 注册表动作与浮层一并消失,settings 数值保留,重启客户端后
 *   env 不再注入(启动 apply 读字段恒定)。
 */

import { Network } from "lucide-react";
import type { Plugin } from "@kernel/plugin";
import { getSettingsState } from "@kernel/settings";
import { ProxyPopover } from "./ProxyPopover";
import { openProxyPopover } from "./proxyPopoverStore";

export const networkProxyPlugin: Plugin = {
  id: "network-proxy",
  meta: {
    name: "网络代理",
    abbr: "NP",
    desc: "客户端与 CLI 子进程统一走 http(s)/socks5 代理",
    icon: Network,
    iconColor: "#45B8C8",
    category: "feature",
  },
  activate(ctx) {
    ctx.contribute("overlay", { order: 20, component: ProxyPopover });
    ctx.registerSidebarAction({
      id: "system-proxy",
      label: "网络代理",
      icon: Network,
      order: 30,
      active: () => getSettingsState().settings.networkProxyEnabled,
      onSelect: (anchor) => openProxyPopover(anchor.x, anchor.y),
    });
  },
};
