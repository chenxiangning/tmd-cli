/**
 * git 面板共享 store —— GitToolbar(顶栏)与 GitPanel(右栏)是两个组件实例,
 * 视图态经模块级 store 共享(useSyncExternalStore,同 filePanel 模式)。
 *
 * refreshNonce:顶栏 ⟳ 点击 bump,GitPanel 监听后触发全量 refresh。
 */

import { useSyncExternalStore } from "react";

export type GitViewMode = "diff" | "branch" | "history";
export type FileListLayout = "tree" | "flat";

interface GitPanelState {
  view: GitViewMode;
  layout: FileListLayout;
  refreshNonce: number;
  /** 顶栏 ⟳ 转圈:批量刷新发起置 true,全部 settle 后清除。 */
  refreshing: boolean;
}

const state: GitPanelState = { view: "diff", layout: "tree", refreshNonce: 0, refreshing: false };
const listeners = new Set<() => void>();
let snapshot: GitPanelState = state;

function emit(): void {
  snapshot = { ...state };
  listeners.forEach((fn) => fn());
}

export function setGitView(view: GitViewMode): void {
  state.view = view;
  emit();
}

export function setGitLayout(layout: FileListLayout): void {
  state.layout = layout;
  emit();
}

/** 顶栏 ⟳ → 面板全量刷新 */
export function bumpGitRefresh(): void {
  state.refreshNonce += 1;
  emit();
}

/** ⟳ 转圈开关:GitPanel 批量刷新发起/结束时调用,按钮据此显示 loading。 */
export function setGitRefreshing(refreshing: boolean): void {
  if (state.refreshing === refreshing) return;
  state.refreshing = refreshing;
  emit();
}

export function useGitPanelState(): GitPanelState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
  );
}
