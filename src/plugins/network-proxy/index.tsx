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

import type { ComponentType } from "react";
import type { Plugin } from "@kernel/plugin";
import { getSettingsState } from "@kernel/settings";
import { ProxyPopover } from "./ProxyPopover";
import { openProxyPopover } from "./proxyPopoverStore";

/** 梯子 icon(lucide-react 无对应 icon,本地内联 SVG;lucide-style props 面,
 *  兼容 Plugin.meta.icon 与 SidebarAction.icon 两处约束)。 */
type LadderProps = { size?: number; className?: string };
const LadderIcon: ComponentType<LadderProps> = ({ size = 14, className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
  >
    <path d="M6 4l-3 16" />
    <path d="M18 4l3 16" />
    <path d="M6 9h12" />
    <path d="M6 14h12" />
    <path d="M4.5 19h15" />
  </svg>
);


export const networkProxyPlugin: Plugin = {
  id: "network-proxy",
  meta: {
    name: "网络代理",
    abbr: "NP",
    desc: "客户端与 CLI 子进程统一走 http(s)/socks5 代理",
    icon: LadderIcon,
    iconColor: "#45B8C8",
    category: "feature",
  },
  activate(ctx) {
    ctx.contribute("overlay", { order: 20, component: ProxyPopover });
    ctx.registerSidebarAction({
      id: "system-proxy",
      label: "网络代理",
      icon: LadderIcon,
      order: 30,
      active: () => getSettingsState().settings.networkProxyEnabled,
      onSelect: (anchor) => openProxyPopover(anchor.x, anchor.y),
    });
  },
};
