/**
 * Welcome 插件 —— 无会话首页(欢迎/引导页)。
 *
 * 职责(单一):贡献 `editorCenter.welcome` 挂点 —— 无活跃 session 时,
 * AppShell MainPanel 整页渲染 WelcomePage(连 composer 一起替换)。
 */

import { House } from "lucide-react";
import type { Plugin } from "@kernel/plugin";
import { WelcomePage } from "./WelcomePage";

export const welcomePlugin: Plugin = {
  id: "welcome",
  meta: {
    name: "欢迎页",
    abbr: "WL",
    desc: "无会话首页:引擎卡片、凭据、最近会话",
    icon: House,
    iconColor: "#E36BD4",
    category: "core",
  },
  activate(ctx) {
    ctx.contribute("editorCenter.welcome", {
      order: 0,
      component: WelcomePage,
    });
  },
};
