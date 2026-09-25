/**
 * 学堂 UI 状态 —— 入门课向导开关 + 指南 tab 打开封装。
 * 向导 overlay 开关同 boardOverlayStore 先例(模块级 store + useSyncExternalStore);
 * guide tab 打开同 memory-console consoleTab 先例(openTab 唯一定义,防循环依赖)。
 */

import { closeTab, getTabs, openTab } from "@kernel/tabs";

/* ── 入门课向导 overlay ─────────────────────────────────────────── */

export interface WizardTarget {
  cliId: string;
  /** 进入时的课下标;继续入门 = 进度 cur,速查 = 末课。 */
  idx: number;
}

let wizard: WizardTarget | null = null;
const wizardSubs = new Set<() => void>();

function emitWizard(): void {
  for (const fn of wizardSubs) fn();
}

export function wizardTarget(): WizardTarget | null {
  return wizard;
}

export function openWizard(cliId: string, idx: number): void {
  wizard = { cliId, idx };
  emitWizard();
}

export function closeWizard(): void {
  if (!wizard) return;
  wizard = null;
  emitWizard();
}

export function useWizardTarget(): WizardTarget | null {
  return wizard;
}

export function subscribeWizard(cb: () => void): () => void {
  wizardSubs.add(cb);
  return () => {
    wizardSubs.delete(cb);
  };
}

/* ── 指南 tab ───────────────────────────────────────────────────── */

export const GUIDE_TAB_KIND = "academy.guide";

/** 打开某 CLI 的指南 tab;已打开则仅激活(openTab 幂等语义)。 */
export function openGuideTab(cliId: string, title: string): void {
  openTab({
    id: `academy:${cliId}`,
    title,
    path: "学堂",
    kind: GUIDE_TAB_KIND,
    payload: { cliId },
  });
}

/** 指南 tab 已开则关闭,未开则打开(入口菜单切换语义)。 */
export function toggleGuideTab(cliId: string, title: string): void {
  const id = `academy:${cliId}`;
  if (getTabs().some((tab) => tab.id === id)) closeTab(id);
  else openGuideTab(cliId, title);
}
