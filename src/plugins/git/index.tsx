import { GitBranch } from "lucide-react";
import type { Plugin } from "@kernel/plugin";
import { registerFilePanel } from "@kernel/filePanel";
import { GitPanel } from "./GitPanel";

/** Git 插件入口:占位面板同样走面板注册表 —— 外壳零 git 硬编码,
 *  完整面板(mossx 核心子集)接入时只换 GitPanel 组件。 */

export const gitPlugin: Plugin = {
  id: "git",
  meta: { name: "Git", abbr: "GT", desc: "Git 状态与面板集成", category: "feature" },
  activate() {
    registerFilePanel({
      id: "git",
      label: "Git",
      icon: GitBranch,
      component: GitPanel,
    });
  },
};
