/**
 * git 面板共享 store —— GitToolbar(顶栏)与 GitPanel(右栏)是两个组件实例,
 * 视图态经模块级 store 共享(useSyncExternalStore,同 filePanel 模式)。
 *
 * refreshNonce:顶栏 ⟳ 点击 bump,GitPanel 监听后触发全量 refresh。
 * aggregate:聚合 ±行数与文件数的只读镜像 —— totals 是重操作,只允许
 * GitPanel 的 useGitTotals 单点拉取,GitToolbar 经此消费,不做第二份轮询。
 */

import { useSyncExternalStore } from "react";
import { spinRemainder } from "@kernel/spin";
import type { GitTotals } from "@kernel/ipc";
import { getSettingsState, updateSettings, type GitFileListLayout, type GitPanelView } from "@kernel/settings";

/** 视图段与文件列表布局的持久化契约归内核 settings(git 编辑域),此处只留插件侧旧名别名。 */
export type GitViewMode = GitPanelView;
export type FileListLayout = GitFileListLayout;

export interface GitAggregate {
  totals: GitTotals | null;
  fileCount: number;
}

export type RemoteDialogOp = "push" | "pull" | "fetch";

interface GitPanelState {
  view: GitViewMode;
  layout: FileListLayout;
  refreshNonce: number;
  /** 顶栏 ⟳ 转圈:批量刷新发起置 true,全部 settle 后清除。 */
  refreshing: boolean;
  aggregate: GitAggregate;
  /** 右键菜单等外部入口请求打开远端对话框;nonce 保证同 op 连发也触发 effect。 */
  remoteDialogRequest: { op: RemoteDialogOp; nonce: number } | null;
}

const state: GitPanelState = {
  view: "diff",
  layout: "flat",
  refreshNonce: 0,
  refreshing: false,
  aggregate: { totals: null, fileCount: 0 },
  remoteDialogRequest: null,
};
const listeners = new Set<() => void>();
let snapshot: GitPanelState = state;

function emit(): void {
  snapshot = { ...state };
  listeners.forEach((fn) => fn());
}

export function setGitView(view: GitViewMode): void {
  state.view = view;
  persistPanelPrefs({ view });
  emit();
}

export function setGitLayout(layout: FileListLayout): void {
  state.layout = layout;
  persistPanelPrefs({ layout });
  emit();
}

/** 视图/布局切换即写 settings(git 编辑域,settings.json 落盘);setter 是唯一写入口,水合不回写。 */
function persistPanelPrefs(patch: Partial<{ view: GitViewMode; layout: FileListLayout }>): void {
  updateSettings({ git: { ...getSettingsState().settings.git, ...patch } });
}

/** 启动水合:插件 activate 时(设置已就绪)把落盘偏好搬进内存 store,不回写。 */
export function hydrateGitPanelPrefs(): void {
  state.view = getSettingsState().settings.git.view;
  state.layout = getSettingsState().settings.git.layout;
  emit();
}

/** 顶栏 ⟳ → 面板全量刷新 */
export function bumpGitRefresh(): void {
  state.refreshNonce += 1;
  emit();
}

/** GitPanel 拉到聚合数据后镜像(值不变不 emit,避免 5s 轮询空转重渲染)。 */
export function setGitAggregate(next: GitAggregate): void {
  const prev = state.aggregate;
  if (prev.fileCount === next.fileCount && prev.totals === next.totals) return;
  state.aggregate = next;
  emit();
}

/** ⟳ 转圈开关:GitPanel 批量刷新发起/结束时调用,按钮据此显示 loading。
 *  收尾经 kernel/spin 兜底:数据再快也转满一圈,防「没点上」错觉;
 *  兜底等待期间再发起(true)会取消挂起的收尾,连续刷新不吞圈。 */
let spinStartedAt = 0;
let spinClearTimer: number | null = null;
export function setGitRefreshing(refreshing: boolean): void {
  if (refreshing) {
    if (spinClearTimer !== null) {
      clearTimeout(spinClearTimer);
      spinClearTimer = null;
    }
    if (state.refreshing) return;
    state.refreshing = true;
    spinStartedAt = Date.now();
    emit();
    return;
  }
  if (!state.refreshing || spinClearTimer !== null) return;
  const wait = spinRemainder(spinStartedAt);
  if (wait === 0) {
    state.refreshing = false;
    emit();
    return;
  }
  spinClearTimer = window.setTimeout(() => {
    spinClearTimer = null;
    if (!state.refreshing) return;
    state.refreshing = false;
    emit();
  }, wait);
}

let remoteDialogNonce = 0;

/** 分支右键菜单「推送...」等入口 → GitPanel 打开对应远端对话框。 */
export function requestRemoteDialog(op: RemoteDialogOp): void {
  remoteDialogNonce += 1;
  state.remoteDialogRequest = { op, nonce: remoteDialogNonce };
  emit();
}

/** GitPanel 消费后清除,防止重复触发。 */
export function clearRemoteDialogRequest(): void {
  if (!state.remoteDialogRequest) return;
  state.remoteDialogRequest = null;
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

/* ── 「暂存并切换」来源(未提交用户工作恢复:cwd + branch 二元组)──
 * 冲突还原(undo)需要知道从哪个仓库的哪个分支切来;对象判等可防
 * A 仓库的冲突横幅在 B 仓库里复活 reset --hard 级还原。
 * 横幅的显隐由 status 轮询(冲突文件出现/消失)驱动重渲染,不依赖它本身。 */
let smartSwitchOrigin: { cwd: string; branch: string } | null = null;

export function setSmartSwitchOrigin(cwd: string, branch: string): void {
  smartSwitchOrigin = { cwd, branch };
}

export function getSmartSwitchOrigin(): { cwd: string; branch: string } | null {
  return smartSwitchOrigin;
}

export function clearSmartSwitchOrigin(): void {
  smartSwitchOrigin = null;
}
