import { GitBranch } from "@phosphor-icons/react";
import type { Plugin } from "@kernel/plugin";
import { getFilePanelMode } from "@kernel/filePanel";
import { hydrateGitPanelPrefs, requestRemoteDialog } from "./panelStore";
import { GitPanel } from "./GitPanel";
import { GitToolbar } from "./GitToolbar";
import { CommitDiffTabContent } from "./CommitDiffTab";
import { DiffTabContent } from "./DiffTabContent";
import { COMMIT_TAB_KIND } from "./commitTab";
import { DIFF_TAB_KIND } from "./diffTab";

/** Git 插件入口:单视图三段面板(差异/分支/历史)+ 提交 diff 中央 tab。
 *  契约见 openspec/changes/git-right-panel/ 与
 *  docs/superpowers/specs/2026-09-04-git-history-graph-design.md;
 *  commit 执行权仅在 DiffView 提交按钮。 */

export const gitPlugin: Plugin = {
  id: "git",
  meta: { name: "Git", abbr: "GT", desc: "Git 状态与面板集成", icon: GitBranch, iconColor: "#F05032", category: "feature" },
  activate(ctx) {
    // 落盘偏好水合(视图段 + 文件列表布局):activate 晚于 settingsReady,直接读即为最终值
    hydrateGitPanelPrefs();
    ctx.registerFilePanel({
      id: "git",
      label: "Git",
      icon: GitBranch,
      component: GitPanel,
      toolbar: GitToolbar, // 顶栏视图下拉(tabs 之后、⋯ 之前),远端动作收编进下拉
      showFileSubbar: false, // 分支/upstream 上顶栏 label(2026-09-14)
    });
    // 右栏 Git 面板(差异/分支/历史)由工具栏与中央 tab 进入,不再单独暴露侧栏快捷动作。
    // 提交 diff tab + 工作区 diff tab:右栏点文件 → 编辑器区打开(同 checkpoints 批审阅单模式)
    ctx.registerTabContent({ kind: COMMIT_TAB_KIND, component: CommitDiffTabContent });
    ctx.registerTabContent({ kind: DIFF_TAB_KIND, component: DiffTabContent });
    // 远端动作命令化(fetch/pull/push):无键位仅暴露,为设置清单改键预留;
    // 常规入口是分支视图右键菜单(更新/获取/推送),命令与 requestRemoteDialog 同通道
    for (const op of ["fetch", "pull", "push"] as const) {
      const labels = { fetch: "获取远端更新(fetch)", pull: "拉取远端(pull)", push: "推送远端(push)" };
      ctx.registerCommand({
        id: `git.${op}`,
        title: labels[op],
        when: () => getFilePanelMode() === "git",
        run: () => requestRemoteDialog(op),
      });
    }
  },
};
