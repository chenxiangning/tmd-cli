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

export function openTab(tab: EditorTab): void {
  const existing = state.tabs.find((t) => t.id === tab.id);
  if (existing) {
    state.activeId = tab.id;
  } else {
    state.tabs.push(tab);
    state.activeId = tab.id;
  }
  emit();
}

export function closeTab(id: string): void {
  state.tabs = state.tabs.filter((t) => t.id !== id);
  emit();
}

export function setActiveTab(id: string | null): void {
  if (state.activeId === id) return;
  state.activeId = id;
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
    () => state,
  );
}
