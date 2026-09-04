import { GitBranch } from "lucide-react";
import type { Plugin } from "@kernel/plugin";
import { registerFilePanel } from "@kernel/filePanel";
import { GitPanel } from "./GitPanel";
import { GitToolbar } from "./GitToolbar";
import { CommitDiffTabContent } from "./CommitDiffTab";

/** Git 插件入口:单视图三段面板(差异/分支/历史)+ 提交 diff 中央 tab。
 *  契约见 openspec/changes/git-right-panel/ 与
 *  docs/superpowers/specs/2026-09-04-git-history-graph-design.md;
 *  commit 执行权仅在 DiffView 提交按钮。 */

export const gitPlugin: Plugin = {
  id: "git",
  meta: { name: "Git", abbr: "GT", desc: "Git 状态与面板集成", icon: GitBranch, iconColor: "#F05032", category: "feature" },
  activate(ctx) {
    registerFilePanel({
      id: "git",
      label: "Git",
      icon: GitBranch,
      component: GitPanel,
      toolbar: GitToolbar,
    });
    // 提交 diff tab:历史 Graph 点文件 → 编辑器区打开(同 checkpoints 批审阅单模式)
    ctx.contribute("editorCenter.tabContent", {
      order: 11,
      component: CommitDiffTabContent,
    });
  },
};

