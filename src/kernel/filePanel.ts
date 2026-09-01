/**
 * 右侧面板(file/git/...)模式 store —— 复刻 codemoss WorkspaceFilePanelMode。
 *
 * 当前实现仅保留 files 与 git 两个实际可用模式;其它 panel tab 在 UI
 * 显示但实际功能未接入,以便未来按挂点扩 panel。
 *
 * 设计:
 * - 单值 store: 当前激活 panel mode。
 * - Pinned tabs(哪些 panel 钉在 toolbar 外显)持久的 clientStorage;
 *   简化版:tmd-cli 暂不持久化,默认 [files, git] 永久钉住。
 */

import { useSyncExternalStore } from "react";

export type FilePanelMode = "files" | "git";

/** 全部 panel tab 类型 ─ UI 上展示用,但只有 files/git 真接入。 */
export type FilePanelTabId =
  | "files"
  | "search"
  | "git"
  | "projectMap"
  | "intentCanvas"
  | "radar"
  | "notes"
  | "specHub"
  | "detachedExplorer";

/** 每个 tab 的元数据。当前只有 files/git 实装并默认钉在 toolbar;
 * 其余为占位,等对应面板接入后再启用。 */
export interface FilePanelTabMeta {
  id: FilePanelTabId;
  label: string;
  /** 是否默认钉在 toolbar。 */
  pinnedByDefault: boolean;
}

export const FILE_PANEL_TABS: FilePanelTabMeta[] = [
  { id: "files", label: "文件", pinnedByDefault: true },
  { id: "search", label: "搜索", pinnedByDefault: false },
  { id: "git", label: "Git", pinnedByDefault: true },
  { id: "projectMap", label: "项目知识地图", pinnedByDefault: false },
  { id: "intentCanvas", label: "意图画布", pinnedByDefault: false },
  { id: "radar", label: "雷达", pinnedByDefault: false },
  { id: "notes", label: "便签", pinnedByDefault: false },
  { id: "specHub", label: "Spec Hub", pinnedByDefault: false },
  { id: "detachedExplorer", label: "打开独立文件窗口", pinnedByDefault: false },
];

interface PanelState {
  mode: FilePanelMode;
  /** 钉在 toolbar 上的 tab ids ─ 实际未持久化,默认 [files, git]。 */
  pinnedIds: Set<FilePanelTabId>;
}

const state: PanelState = {
  mode: "files",
  // 默认只钉 文件 + Git;其余 tab 未实装,钉出来只是死图标,等接入后再加默认。
  pinnedIds: new Set(["files", "git"] as FilePanelTabId[]),
};

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((fn) => fn());
}
let snapshot: PanelState = state;
function refreshSnapshot(): PanelState {
  snapshot = { mode: state.mode, pinnedIds: new Set(state.pinnedIds) };
  return snapshot;
}

export function setFilePanelMode(mode: FilePanelMode): void {
  if (state.mode === mode) return;
  state.mode = mode;
  refreshSnapshot();
  emit();
}

export function togglePinned(id: FilePanelTabId): void {
  const next = new Set(state.pinnedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  state.pinnedIds = next;
  refreshSnapshot();
  emit();
}

export function getFilePanelMode(): FilePanelMode {
  return state.mode;
}

export function getPinnedPanelIds(): readonly FilePanelTabId[] {
  return Array.from(state.pinnedIds);
}

export function useFilePanel(): PanelState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot,
  );
}