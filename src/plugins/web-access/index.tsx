/**
 * web-access 插件:LAN Web 访问的设置卡 + 「远程控制中」徽标。
 * 桥/分发/事件广播全在 Rust(src-tauri/src/web/);前端只注册 UI 贡献。
 */

import { Globe, DeviceMobile } from "@phosphor-icons/react";
import type { Plugin } from "@kernel/plugin";
import { WebAccessSection } from "./WebAccessSection";
import { RemoteControlBadge } from "./RemoteControlBadge";
import { WebWanGate } from "./WebWanGate";
import { WebCfPane } from "./WebCfPane";
import { WebSelfHostPane } from "./WebSelfHostPane";
import { WebDevicePairCard } from "./WebDevicePairCard";

/* 两个外网 tab 各包一次风险门;确认态全局共享,只弹一次。 */
function WebCfGate() {
  return <WebWanGate Pane={WebCfPane} />;
}
function WebSelfHostGate() {
  return <WebWanGate Pane={WebSelfHostPane} />;
}

export const webAccessPlugin: Plugin = {
  id: "web-access",
  meta: {
    name: "Web 访问",
    abbr: "WA",
    desc: "局域网内用手机/平板浏览器访问本机会话",
    icon: Globe,
    iconColor: "#4F9CF9",
    category: "feature",
  },
  activate(ctx) {
    /* order 负值 = 左区按钮簇最左(徽标非交互,排终端钮前)。 */
    ctx.contribute("header.leftCluster", { order: -10, component: RemoteControlBadge });
    ctx.registerSettingsSection({
      id: "web-access",
      title: "Web 访问",
      description: "局域网/外网用手机/平板浏览器访问本机会话。",
      icon: <Globe size="0.875rem" aria-hidden />,
      order: 45,
      tabs: [
        {
          id: "lan",
          title: "内网",
          icon: <Globe size="0.875rem" aria-hidden />,
          order: 0,
          component: WebAccessSection,
        },
        {
          id: "cf",
          title: "Cloudflare",
          icon: <Globe size="0.875rem" aria-hidden />,
          order: 1,
          component: WebCfGate,
        },
        {
          id: "selfhost",
          title: "自建服务器",
          icon: <Globe size="0.875rem" aria-hidden />,
          order: 2,
          component: WebSelfHostGate,
        },
        {
          id: "devices",
          title: "设备",
          icon: <DeviceMobile size="0.875rem" aria-hidden />,
          order: 3,
          component: WebDevicePairCard,
        },
      ],
    });
  },
};
