/**
 * 可订阅快照 store —— kernel 各注册表(filePanel / sidebarActions / tabs /
 * sessionTabs / homePanels / settingsRegistry)逐字同构样板的公共形状:
 * listeners 集合 + 引用稳定快照 + useSyncExternalStore 订阅。
 *
 * 快照约定:不可变,整体换引用(commit/replace);两次变更之间 snapshot
 * 返回同一引用(useSyncExternalStore 按引用比较,原地改 = 漏渲染,
 * getSnapshot 每次新建 = 死循环)。
 */

import { useSyncExternalStore } from "react";

interface Subscribable<S> {
  /** 当前快照;两次变更之间引用稳定。 */
  readonly snapshot: S;
  /** 换快照并通知订阅者(常规提交)。 */
  commit(next: S): void;
  /** 只换快照引用不通知 —— 与 notify 拆开排非常规提交序列(tabs 的 activeId 兜底)。 */
  replace(next: S): void;
  /** 只通知订阅者,不换快照。 */
  notify(): void;
  /** React 订阅;select 取切片时返回值必须引用稳定(直接取快照字段,不现算)。 */
  useStore<T = S>(select?: (snapshot: S) => T): T;
}

/** 建一个可订阅快照 store;initial 即初始快照引用。 */
export function createSubscribable<S>(initial: S): Subscribable<S> {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    get snapshot() {
      return snapshot;
    },
    commit(next) {
      snapshot = next;
      listeners.forEach((fn) => fn());
    },
    replace(next) {
      snapshot = next;
    },
    notify() {
      listeners.forEach((fn) => fn());
    },
    useStore<T = S>(select?: (snapshot: S) => T): T {
      return useSyncExternalStore(
        (fn) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        () => (select ? select(snapshot) : (snapshot as unknown as T)),
      );
    },
  };
}
