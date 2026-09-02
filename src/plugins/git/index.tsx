import { GitBranch } from "lucide-react";
import type { Plugin } from "@kernel/plugin";
import { registerFilePanel } from "@kernel/filePanel";
import { GitPanel } from "./GitPanel";
import { GitToolbar } from "./GitToolbar";

/** Git 插件入口:单视图三段面板(差异/分支/历史),外壳零 git 硬编码。
 *  契约见 openspec/changes/git-right-panel/;commit 执行权仅在 DiffView 提交按钮。 */

export const gitPlugin: Plugin = {
  id: "git",
  meta: { name: "Git", abbr: "GT", desc: "Git 状态与面板集成", category: "feature" },
  activate() {
    registerFilePanel({
      id: "git",
      label: "Git",
      icon: GitBranch,
      component: GitPanel,
      toolbar: GitToolbar,
    });
  },
};
