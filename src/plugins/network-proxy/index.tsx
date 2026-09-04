/**
 * network-proxy 插件 —— 网络代理开关浮层(独立插头,插件市场可插拔)。
 *
 * - 职责:「网络代理」浮层(滑动块启用开关 + 代理地址,校验/归一见 proxyCommit);
 *   经 overlay 挂点常驻(关闭态渲染 null),portal 挂 body。
 * - 入口:app-shell 侧栏齿轮菜单/底栏钉住的「网络代理」按钮,经内核事件总线
 *   NETWORK_PROXY_POPOVER_TOPIC 携锚点坐标触发(壳与插件互不引用)。
 * - 生效在 Rust proxy.rs(进程 env 注入):客户端联网 + 之后 spawn 的 CLI 子进程。
 *   拔出插件 = 浮层断电(侧栏入口发出的 topic 无人订阅,点了没反应),
 *   settings 数值保留,重启客户端后 env 不再注入(启动 apply 读字段恒定)。
 */

import { Network } from "lucide-react";
import type { Plugin } from "@kernel/plugin";
import { ProxyPopover } from "./ProxyPopover";
import { openProxyPopover } from "./proxyPopoverStore";

/** 打开浮层的内核事件 topic(payload: {x,y} 锚点视口坐标)。 */
const NETWORK_PROXY_POPOVER_TOPIC = "plugin.network-proxy.popover.open";

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
    ctx.events.on<{ x: number; y: number }>(NETWORK_PROXY_POPOVER_TOPIC, ({ x, y }) => {
      openProxyPopover(x, y);
    });
  },
};
