/**
 * repoContext —— 多仓模式分档纯函数(spec 2026-09-07-git-multi-repo-design §3)。
 * GitPanel 每渲染帧调用:输入 = workspace root + 扫描结果 + 按工作区记忆的选中仓,
 * 输出唯一决定「面板语境 cwd / 仓切换条可见 / 引导列表 vs 空态」。
 * 红线:单仓(root 是仓且唯一)输出 selectedPath = root 且 showRepoBar = false,
 * 与现状行为逐项一致,不出现任何新 UI。
 */

import type { GitRepoSummary } from "@kernel/ipc";

type GitRepoMode =
  /** root 是仓且唯一:与现状逐像素一致 */
  | "single"
  /** 已有选中仓(root 是仓默认 root;非仓根经引导/记忆点选) */
  | "multi"
  /** root 非仓且有子仓、尚未选中:渲染发现引导列表 */
  | "guide"
  /** 无仓:现状空态文案 */
  | "empty";

export interface GitRepoContext {
  mode: GitRepoMode;
  /** 面板语境 cwd;null = 空态/引导(无可用选中仓) */
  selectedPath: string | null;
  /** 仓切换条可见性:≥2 仓且已有选中(引导态不叠切换条) */
  showRepoBar: boolean;
}

export function resolveRepoContext(
  root: string | null,
  repos: readonly GitRepoSummary[],
  remembered: string | null,
): GitRepoContext {
  if (!root || repos.length === 0) {
    return { mode: "empty", selectedPath: null, showRepoBar: false };
  }
  const rememberedValid = remembered != null && repos.some((r) => r.path === remembered);
  const rootIsRepo = repos.some((r) => r.path === root);
  if (rootIsRepo) {
    const selected = rememberedValid ? remembered! : root;
    const multi = repos.length >= 2;
    return { mode: multi ? "multi" : "single", selectedPath: selected, showRepoBar: multi };
  }
  if (!rememberedValid) {
    return { mode: "guide", selectedPath: null, showRepoBar: false };
  }
  return {
    mode: "multi",
    selectedPath: remembered,
    showRepoBar: repos.length >= 2,
  };
}
