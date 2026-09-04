/**
 * 编辑器标签页全局 store —— 跨会话共享(mossx 习惯)。
 * 由外壳和"可开 tab 的"插件(files、未来的 editor)读写。
 *
 * 设计:
 * - tab id = plugin 域路径(如 "file:/abs/path")。每次 open 路径已存在则激活。
 * - kind:用于 tabBar 排序分组显示。v1 固定 "file"。
 * - title/path:渲染用。
 * - payload:各插件自定义,只对该插件 mount 组件有意义(避免胖接口)。
 *
 * 不内置缓存文件内容 —— 内容由插件自己负责(open 时新拉)。
 */

import { useSyncExternalStore } from "react";

export interface EditorTab {
  /** 全局唯一 tab id。 */
  id: string;
  /** 显示标题,tab bar 用。 */
  title: string;
  /** 路径/定位信息,标题里塞不下时可用。 */
  path: string;
  /** 分类(不同插件用不同 kind,排序分组)。 */
  kind: string;
  /** 插件自定义负载:tabContent mount 按 id 渲染时读这个。 */
  payload: unknown;
  /** 文件 tab 专用:有未保存修改时 tab 栏渲染圆点。由编辑侧经 updateTab 维护。 */
  dirty?: boolean;
}

interface TabState {
  tabs: EditorTab[];
  activeId: string | null;
}

const state: TabState = { tabs: [], activeId: null };
const listeners = new Set<() => void>();
function emit() {
  state.activeId = state.tabs.some((t) => t.id === state.activeId)
    ? state.activeId
    : state.tabs[0]?.id ?? null;
  listeners.forEach((fn) => fn());
}
/** useSyncExternalStore 的 snapshot — 返回新引用,让 React 检测变化。 */
let snapshot: TabState = state;
function refreshSnapshot(): TabState {
  snapshot = { tabs: [...state.tabs], activeId: state.activeId };
  return snapshot;
}

export function openTab(tab: EditorTab, opts?: { refresh?: boolean }): void {
  const existing = state.tabs.find((t) => t.id === tab.id);
  if (existing) {
    /* refresh(显式 opt-in):激活并把 title/payload 刷成最新 —— 深链重开场景
       payload 携带新的定位目标;缺省保持旧语义(保留首次注册,不覆盖) */
    if (opts?.refresh) {
      existing.title = tab.title;
      existing.payload = tab.payload;
    }
    state.activeId = tab.id;
  } else {
    state.tabs.push(tab);
    state.activeId = tab.id;
   }
  refreshSnapshot();
  emit();
}

export function closeTab(id: string): void {
   state.tabs = state.tabs.filter((t) => t.id !== id);
  refreshSnapshot();
  emit();
}

/** 关闭除 id 外的全部 tab;id 不存在时等同关闭全部。 */
export function closeOtherTabs(id: string): void {
  state.tabs = state.tabs.filter((t) => t.id === id);
  refreshSnapshot();
  emit();
}

export function closeAllTabs(): void {
  state.tabs = [];
  refreshSnapshot();
  emit();
}

/**
 * 原地合并 tab 字段(title/dirty 等)—— openTab 对已存在 id 只激活不覆盖,
 * 编辑态(脏标记)需要单独的更新通道。id 不存在时静默忽略(不复活已关 tab)。
 */
export function updateTab(
  id: string,
  patch: Partial<Pick<EditorTab, "title" | "dirty">>,
): void {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;
  if (patch.title !== undefined) tab.title = patch.title;
  if (patch.dirty !== undefined) tab.dirty = patch.dirty;
  refreshSnapshot();
  emit();
}

export function setActiveTab(id: string | null): void {
  if (state.activeId === id) return;
   state.activeId = id;
  refreshSnapshot();
  emit();
}

export function getTabs(): readonly EditorTab[] {
  return state.tabs;
}

export function getActiveTabId(): string | null {
  return state.activeId;
}

export function useEditorTabs(): TabState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
        () => snapshot,
  );
}
