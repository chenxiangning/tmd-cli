/**
 * CLI 学堂 —— 多 CLI 通用的引导学习插件。
 *
 * 注册点:
 * - leftSidebar.section(order -1):左栏顶部学堂入口(进度 + 课程菜单);
 * - overlay(order 45):入门课向导(看板同款「不透明覆盖、下层零回放」);
 * - registerTabContent("academy.guide"):指南中央 tab(payload.cliId 路由课程)。
 *
 * 课程内容全部来自 cli-* 插件经 ctx.registerAcademyCourse 注册(kernel/academy.ts
 * 契约);本插件零 CLI 私有知识,新增 claude/codex/pi 课程零改这里。
 * 设计:docs/superpowers/specs/2026-09-25-cli-academy-design.md
 */
import { Student } from "@phosphor-icons/react";
import type { Plugin, PluginContext } from "@kernel/plugin";
import { AcademyEntry } from "./academyEntry";
import { AcademyWizard } from "./wizard";
import { GuideTab } from "./guideTab";
import "./academy.css";

export const academyPlugin: Plugin = {
  id: "academy",
  meta: {
    name: "CLI 学堂",
    abbr: "学堂",
    desc: "多 CLI 引导学习:斜杠命令指南、入门课与练习,课程由各引擎插件供给",
    icon: Student,
    iconColor: "#5B9BD5",
    category: "feature",
  },
  activate(ctx: PluginContext) {
    ctx.contribute("leftSidebar.section", { order: -1, component: AcademyEntry });
    ctx.contribute("overlay", { order: 45, component: AcademyWizard });
    ctx.registerTabContent({ kind: "academy.guide", component: GuideTab });
  },
};
