/**
 * 侧栏快捷动作注册点 —— 左下角设置簇(齿轮菜单 + 底栏钉住)的数据源。
 *
 * 插件 activate 时注册自己的动作(图标/激活态/回调),壳只渲染注册表、
 * 不认识任何具体动作 —— 与 filePanel「外壳不认识任何业务面板」同纪律。
 * 钉住状态(pin 列表)归壳 UI 所有,按动作 id 持久化(localStorage);
 * 插件拔出 = 动作从注册表消失,钉住项自动隐藏,重新插入后原样恢复。
 */

import { useSyncExternalStore, type ComponentType } from "react";

/** 动作图标的最小 props 面(兼容 @phosphor-icons-react 图标组件)。 */
export type SidebarActionIcon = ComponentType<{
  size?: number;
  className?: string;
}>;

export interface SidebarAction {
  /** 全局唯一 id,同时是壳侧 pin 持久化键。 */
  id: string;
  /** 菜单行/底栏按钮标签。 */
  label: string;
  /** 语义图标(@phosphor-icons-react 或自绘),渲染时传 size。 */
  icon: SidebarActionIcon;
  /** 菜单内排序,小的在前。 */
  order?: number;
  /** 激活态(开关/面板已开类动作);渲染期求值,缺省 = 恒不激活。
   *  响应性随宿主组件重渲染(设置变更等),不自建订阅。 */
  active?: () => boolean;
  /** 触发动作;anchor = 触发簇右缘锚点坐标(浮层类动作的定位参考)。 */
  onSelect: (anchor: { x: number; y: number }) => void;
}

const state: { actions: readonly SidebarAction[] } = { actions: [] };

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((fn) => fn());
}
let snapshot = state;
function refreshSnapshot() {
  snapshot = { actions: state.actions };
  return snapshot;
}

/** 注册侧栏动作(插件 activate 内调用)。重复 id 抛错,与 registerFilePanel 同纪律。 */
export function registerSidebarAction(action: SidebarAction): void {
  if (state.actions.some((a) => a.id === action.id)) {
    throw new Error(`侧栏动作重复注册: ${action.id}`);
  }
  state.actions = [...state.actions, action].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  refreshSnapshot();
  emit();
}

export function useSidebarActions(): readonly SidebarAction[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot.actions,
  );
}
