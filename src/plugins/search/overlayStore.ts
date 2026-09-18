/**
 * search 插件共享态 —— 浮层开关(两命令写入,overlay 组件订阅渲染)+
 * 工作区 root 取法(与 FileTree 同源:激活工作区缺省回落首项)。
 * boardOverlayStore 同款模块级 subscribable;同一时刻最多开一个,再开顶替。
 */
import { useSyncExternalStore } from "react";
import { useWorkspaces } from "@kernel/workspace";

export type SearchOverlayKind = "panel" | "quickOpen";

let kind: SearchOverlayKind | null = null;
const subs = new Set<() => void>();

function emit(): void {
  for (const fn of subs) fn();
}

export function openSearchOverlay(next: SearchOverlayKind): void {
  kind = next;
  emit();
}

export function closeSearchOverlay(): void {
  if (kind === null) return;
  kind = null;
  emit();
}

/** useSyncExternalStore 订阅面。 */
export function subscribeSearchOverlay(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

/** 当前浮层(null = 关);useSyncExternalStore 快照函数。 */
export function searchOverlayKind(): SearchOverlayKind | null {
  return kind;
}

export function useSearchOverlay(): SearchOverlayKind | null {
  return useSyncExternalStore(subscribeSearchOverlay, searchOverlayKind);
}

/** 面板共用的 root:激活工作区,缺省回落首项(FileTree 同款取法,不新造通道)。 */
export function useActiveWorkspaceRoot(): string | null {
  const { list, activeId } = useWorkspaces();
  return (list.find((w) => w.id === activeId) ?? list[0])?.root ?? null;
}
