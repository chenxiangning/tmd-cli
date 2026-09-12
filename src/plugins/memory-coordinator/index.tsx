/**
 * memory-coordinator 插件 —— Magic Context 记忆池的 tmd-cli 侧编排。
 *
 * - 数据归宿:Magic Context(外部,MIT)共享 SQLite;本插件只读消费 + 编排,
 *   写入一律经官方管线(d 路 omp 会话代写,Phase 2),本插件零直写。
 * - 贡献面(全部经 ctx 注册面):
 *   · 右栏 Memory 面板(filePanel)
 *   · composer 记忆胶囊(composer.statusBar,5 家读通路)
 *   · Memory 控制台 tab(EditorCenter 位,kind="memory-console")
 */

import { Brain } from "@phosphor-icons/react";
import "./locales"; /* 域词典随插件自带:i18n.registerMessages(import 即注册) */
import type { Plugin } from "@kernel/plugin";
import { MemoryPanel } from "./panel/MemoryPanel";
import { MemoryConsole } from "./console/MemoryConsole";
import { MemoryCapsule } from "./capsule/MemoryCapsule";
import { attachAutoDistill } from "./phase2/autoDistill";

let detachAutoDistill: (() => void) | null = null;

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
    ctx.registerFilePanel({
      id: "memory",
      label: "Memory",
      icon: Brain,
      component: MemoryPanel,
      showFileSubbar: false,
      order: 40,
    });
    ctx.registerTabContent({
      kind: "memory-console",
      component: MemoryConsole,
    });
    ctx.contribute("composer.statusBar", {
      order: 20,
      component: MemoryCapsule,
    });
  },
  deactivate() {
    detachAutoDistill?.();
    detachAutoDistill = null;
  },
};
