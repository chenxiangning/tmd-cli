/**
 * 工作区 diff tab 契约 —— 差异视图与中央编辑器区 tab 共同依赖。
 *
 * tab id = `git-diff:<s|w>:<cwd>`(一仓一侧一 tab,与提交 diff tab 同构);
 * kind = "git-diff";payload 携带 cwd/staged/focusPath(点列表文件进入时的深链),
 * tab 内左列清单切换文件不回头改 payload。
 * 选侧规则与原抽屉一致:staged=true 仅当「已暂存且工作区无叠加改动」(wt 优先)。
 */

import { t } from "@kernel/i18n";
import { baseName } from "@kernel/pathUtils";
import { openTab } from "@kernel/tabs";

export const DIFF_TAB_KIND = "git-diff";

export interface DiffTabPayload {
  cwd: string;
  /** true = 暂存区 vs HEAD;false = 工作区 vs 暂存区 */
  staged: boolean;
  /** 打开后默认选中的文件(点列表文件进入时的深链);缺省 = 清单首个 */
  focusPath?: string;
}

/** 打开(或聚焦)工作区 diff tab;refresh:重复打开把 focusPath 刷成最新。
 *  标题带仓名:多仓同开 s/w 双侧时 tab 条可区分(悬浮 path = 仓根全路径)。 */
export function openDiffTab(tab: DiffTabPayload): void {
  const repo = baseName(tab.cwd) || tab.cwd;
  openTab(
    {
      id: `${DIFF_TAB_KIND}:${tab.staged ? "s" : "w"}:${tab.cwd}`,
      kind: DIFF_TAB_KIND,
      title: tab.staged ? `${repo} — ${t("暂存区 diff")}` : `${repo} — ${t("工作区 diff")}`,
      /* 标签渲染走 kind 注册图标 + title;path 作悬浮定位信息(仓根) */
      path: tab.cwd,
      payload: { ...tab },
    },
    { refresh: true },
  );
}

export function readDiffTabPayload(tab: {
  kind: string;
  payload: unknown;
}): DiffTabPayload | null {
  if (tab.kind !== DIFF_TAB_KIND) return null;
  const p = tab.payload as Partial<DiffTabPayload> | null;
  if (!p?.cwd) return null;
  return { cwd: p.cwd, staged: p.staged ?? false, focusPath: p.focusPath };
}
