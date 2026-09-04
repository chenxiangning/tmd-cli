/**
 * 工作区 diff tab 契约 —— 差异视图与中央编辑器区 tab 共同依赖。
 *
 * tab id = `git-diff:<s|w>:<path>`(按 文件+侧 锚定,工作区/暂存区各一 tab);
 * kind = "git-diff";payload 携带 cwd/path/staged/status。
 * 选侧规则与原抽屉一致:staged=true 仅当「已暂存且工作区无叠加改动」(wt 优先)。
 * path 取 `<cwd>/<文件相对路径>`:AppShell tab 标签渲染 baseName(path) → 文件名。
 */

import { openTab } from "@kernel/tabs";

export const DIFF_TAB_KIND = "git-diff";

export interface DiffTabPayload {
  cwd: string;
  path: string;
  /** true = 暂存区 vs HEAD;false = 工作区 vs 暂存区 */
  staged: boolean;
  status: string;
}

/** 打开(或聚焦)工作区 diff tab;refresh 语义下重复点击即聚焦。 */
export function openDiffTab(tab: DiffTabPayload): void {
  openTab({
    id: `${DIFF_TAB_KIND}:${tab.staged ? "s" : "w"}:${tab.path}`,
    kind: DIFF_TAB_KIND,
    title: `${tab.path} — ${tab.staged ? "已暂存" : "工作区"} diff`,
    path: `${tab.cwd}/${tab.path}`,
    payload: { ...tab },
  });
}

export function readDiffTabPayload(tab: {
  kind: string;
  payload: unknown;
}): DiffTabPayload | null {
  if (tab.kind !== DIFF_TAB_KIND) return null;
  const p = tab.payload as Partial<DiffTabPayload> | null;
  if (!p?.cwd || !p?.path) return null;
  return { cwd: p.cwd, path: p.path, staged: p.staged ?? false, status: p.status ?? "" };
}
