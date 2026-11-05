/**
 * 侧栏段折叠 store(已置顶区 / 运行区)—— 自组件内 useState 抽出。
 * 动机:顶栏「定位」需要从 workspace 插件的 reveal handler 远程展开段,
 * 组件局部 state 做不到;照 app-shell/editorMaximized.ts 样板落模块级 store。
 * localStorage 键与原实现逐字节一致,折叠态迁移无损。
 */

import { useSyncExternalStore } from "react";
function createSectionToggle(key: string) {
  /* 惰性首读:模块 import 发生在 node 测试环境(无 localStorage),渲染时才落值。 */
  let collapsed: boolean | null = null;
  const listeners = new Set<() => void>();
  const read = (): boolean => {
    if (collapsed === null) collapsed = localStorage.getItem(key) === "1";
    return collapsed;
  };
  return {
    /** React 订阅(useSyncExternalStore)。 */
    use: () =>
      useSyncExternalStore(
        (fn) => {
          listeners.add(fn);
          return () => {
            listeners.delete(fn);
          };
        },
        read,
      ),
    /** 写入并持久化(值不变时静默,不触发重渲染)。 */
    set: (v: boolean) => {
      if (read() === v) return;
      collapsed = v;
      localStorage.setItem(key, v ? "1" : "0");
      listeners.forEach((fn) => fn());
    },
  };
}

export const pinnedSection = createSectionToggle("tmd.pinnedSectionCollapsed");
export const runningSection = createSectionToggle("tmd.runningSectionCollapsed");
