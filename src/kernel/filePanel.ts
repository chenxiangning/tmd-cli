/**
 * 右侧面板注册表 + 激活/钉住状态 store。
 *
 * kernel 只提供「tab 注册 + 激活/钉住」通用原语,不预知任何业务面板
 * (files/git/search 都是产品路线图,不是内核知识);面板 id/图标/组件
 * 由各自插件 activate 时注册:
 *   files 插件 → { id: "files", label: "文件", ... }
 *   git 插件   → { id: "git",   label: "Git", ... }
 * 外壳(AppShell 右栏 / TopBarPanelTabs)只按注册表渲染 —— 新增面板零改外壳。
 */

import { useSyncExternalStore, type ComponentType } from "react";

/** 面板图标的最小 props 面(兼容 lucide-react 图标组件)。 */
export type FilePanelIcon = ComponentType<{
  size?: number | string;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

/** 插件注册的右栏面板。 */
export interface FilePanelContribution {
  /** 全局唯一 id(插件自带,如 "files"/"git");重复注册即抛错。 */
  id: string;
  /** tab 的 aria/title 文案。 */
  label: string;
  icon: FilePanelIcon;
  /** 面板内容组件(激活时整栏渲染)。 */
  component: ComponentType;
  /** 顶栏嵌入段(激活时渲染在 panel tabs 左侧,对齐 codemoss 单行顶栏);
   *  与 component 是两棵组件树,共享状态须走插件内模块级 store。 */
  toolbar?: ComponentType;
  /** 面板数据刷新(可选):外壳刷新按钮点击时调用;返回 Promise 则按钮转到 settle。
   *  实现同样经插件内 store/引用转发到面板组件(如 FileTree 的 reload 全量重拉)。 */
  refresh?: () => void | Promise<void>;
  /** 新建文件/文件夹(可选):顶栏对应按钮点击时调用;缺省按钮置灰。 */
  newFile?: () => void;
  newFolder?: () => void;
  /** 是否显示外壳 workspace 文件操作行(路径 + 新建/刷新);缺省 true。
   * 自带摘要行的面板(git 聚合行 / checkpoints 审批线摘要 / ssh 连接段)声明 false ——
   * 外壳不认识任何业务面板,可见性由面板自己声明,不硬编码 id。 */
  showFileSubbar?: boolean;
  /** tab 排序,小的在前;缺省 0。 */
  order?: number;
  /** 注册即钉到 toolbar;缺省 true。 */
  pinnedByDefault?: boolean;
}

interface FilePanelState {
  /** 已注册面板(按 order 升序);数组不可变,注册时整体替换。 */
  panels: readonly FilePanelContribution[];
  /** 当前激活面板 id;首个注册面板自动成为初始激活。 */
  mode: string;
  /** 钉在 toolbar 外显的面板 id。 */
  pinnedIds: ReadonlySet<string>;
}

const state: FilePanelState = {
  panels: [],
  mode: "",
  pinnedIds: new Set(),
};

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((fn) => fn());
}
let snapshot: FilePanelState = state;
function refreshSnapshot(): FilePanelState {
  snapshot = { panels: state.panels, mode: state.mode, pinnedIds: new Set(state.pinnedIds) };
  return snapshot;
}

/** 注册右栏面板(插件 activate 内调用)。重复 id 抛错,与 registerCliProfile 同纪律。 */
export function registerFilePanel(panel: FilePanelContribution): void {
  if (state.panels.some((p) => p.id === panel.id)) {
    throw new Error(`右栏面板重复注册: ${panel.id}`);
  }
  state.panels = [...state.panels, panel].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  if (panel.pinnedByDefault ?? true) {
    state.pinnedIds = new Set([...state.pinnedIds, panel.id]);
  }
  if (!state.mode) state.mode = panel.id;
  refreshSnapshot();
  emit();
}

export function setFilePanelMode(id: string): void {
  if (state.mode === id) return;
  state.mode = id;
  refreshSnapshot();
  emit();
}

export function togglePinned(id: string): void {
  const next = new Set(state.pinnedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  state.pinnedIds = next;
  refreshSnapshot();
  emit();
}

export function getFilePanels(): readonly FilePanelContribution[] {
  return state.panels;
}

export function getFilePanelMode(): string {
  return state.mode;
}

export function getPinnedPanelIds(): readonly string[] {
  return Array.from(state.pinnedIds);
}

export function useFilePanel(): FilePanelState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot,
  );
}
