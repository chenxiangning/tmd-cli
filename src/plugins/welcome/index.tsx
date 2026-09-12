/**
 * Welcome 插件 —— 无会话首页(欢迎/引导页)。
 *
 * 职责(单一):贡献 `editorCenter.welcome` 挂点 —— 无活跃 session 时,
 * AppShell MainPanel 整页渲染 WelcomePage(连 composer 一起替换)。
 */

import { House } from "@phosphor-icons/react";
import "./locales"; /* 域词典随插件自带:i18n.registerMessages(import 即注册) */
import type { Plugin } from "@kernel/plugin";
import { WelcomePage } from "./WelcomePage";

export const welcomePlugin: Plugin = {
  id: "welcome",
  meta: {
    name: "欢迎页",
    abbr: "WL",
    desc: "无会话首页:引擎全动作行、凭据额度、续作",
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
