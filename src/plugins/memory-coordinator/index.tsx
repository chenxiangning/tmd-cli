/**
 * memory-coordinator 插件 —— Magic Context 记忆池的 tmd-cli 侧编排。
 *
 * - 数据归宿:Magic Context(外部,MIT)共享 SQLite;本插件只读消费 + 编排,
 *   记忆写入一律经官方管线(d 路 omp 会话代写,Phase 2),记忆面零直写。
 *   例外:lint/ 子模块(记忆文件面板内嵌的「规则体检」,tmd-lint 收编)对
 *   规则文件直写,走 cli-config 同款备份+守卫口径(见 lint/applyLint.ts)。
 * - 贡献面(全部经 ctx 注册面):
 *   · 右栏 Memory 面板 + 记忆文件面板(filePanel,后者内嵌规则体检视图)
 *   · composer 记忆胶囊(composer.statusBar,5 家读通路)
 *   · Memory 控制台 tab(EditorCenter 位,kind="memory-console")
 */

import { Brain, Notebook } from "@phosphor-icons/react";
import { DecorIcon } from "@kernel/iconSet";
import "./locales"; /* 域词典随插件自带:i18n.registerMessages(import 即注册) */
import "./lint/locales"; /* lint 域词典(规则体检内嵌视图) */
import { lazySuspense } from "@kernel/lazyTab";
import type { Plugin } from "@kernel/plugin";
import { MemoryPanel } from "./panel/MemoryPanel";
import { MemoryFilesPanel } from "./panel/MemoryFilesPanel";
import { MemoryCapsule } from "./capsule/MemoryCapsule";
import { attachAutoDistill } from "./phase2/autoDistill";
import { attachWikiStore } from "./wiki/wikiHook";
import "./wiki/locales"; /* agent wiki 域词典 */

let detachAutoDistill: (() => void) | null = null;
let detachWikiStore: (() => void) | null = null;

export const memoryCoordinatorPlugin: Plugin = {
  id: "memory-coordinator",
  meta: {
    name: "Memory 协调器",
    abbr: "MC",
    desc: "Magic Context 记忆池:多引擎共享项目记忆,胶囊注入与池检索",
    icon: Brain,
    iconColor: "#7C6FE0",
    category: "feature",
  },
  activate(ctx) {
    detachAutoDistill = attachAutoDistill();
    detachWikiStore = attachWikiStore();
    ctx.registerFilePanel({
      id: "memory",
      label: "Memory",
      icon: Brain,
      component: MemoryPanel,
      order: 31, /* 能力生态组首席(memory/skills/mcp 钉 rail 底簇,与 ⋯ 呼应) */
      railGroup: "ecosystem",
      railBottom: true,
    });
    ctx.registerFilePanel({
      id: "memory-files",
      label: "AI规则文件管理",
      icon: Notebook,
      component: MemoryFilesPanel,
      order: 32, /* memory 旁:跨引擎原生记忆文件,与记忆池面板并列生态组 */
      railGroup: "ecosystem",
      railBottom: true,
    });
    ctx.registerTabContent({
      kind: "memory-console",
      component: lazySuspense(() => import("./console/MemoryConsole").then((m) => ({ default: m.MemoryConsole }))),
      icon: (p) => <DecorIcon id="panel-memory" Fallback={Brain} {...p} />,
    });
    ctx.registerTabContent({
      kind: "agent-wiki",
      component: lazySuspense(() => import("./wiki/WikiPanel").then((m) => ({ default: m.WikiPanel }))),
      icon: (p) => <DecorIcon id="panel-memory" Fallback={Notebook} {...p} />,
    });
    ctx.registerTabContent({
      kind: "lint-report",
      component: lazySuspense(() => import("./lint/LintReportTab").then((m) => ({ default: m.LintReportTab }))),
      icon: (p) => <DecorIcon id="panel-memory" Fallback={Notebook} {...p} />,
      keepAlive: true, /* 切走再切回,列表滚动位置与筛选态不丢(纯前端态,常驻可承受) */
    });
    ctx.contribute("composer.statusBar", {
      order: 20,
      component: MemoryCapsule,
    });
  },
  deactivate() {
    detachAutoDistill?.();
    detachAutoDistill = null;
    detachWikiStore?.();
    detachWikiStore = null;
  },
};
