/**
 * search 插件共享态 —— 浮层开关(两命令写入,overlay 组件订阅渲染)+
 * 工作区 root 取法(与 FileTree 同源:激活工作区缺省回落首项)。
 * kernel createSubscribable 快照 store;同一时刻最多开一个,再开顶替。
 */
import { useWorkspaces } from "@kernel/workspace";
import { createSubscribable } from "@kernel/subscribable";

export type SearchOverlayKind = "panel" | "quickOpen";

const store = createSubscribable<SearchOverlayKind | null>(null);

export function openSearchOverlay(next: SearchOverlayKind): void {
  store.commit(next);
}

export function closeSearchOverlay(): void {
  if (store.snapshot === null) return;
  store.commit(null);
}

/** 当前浮层(null = 关)。 */
export function searchOverlayKind(): SearchOverlayKind | null {
  return store.snapshot;
}

export function useSearchOverlay(): SearchOverlayKind | null {
  return store.useStore();
}

/** 面板共用的 root:激活工作区,缺省回落首项(FileTree 同款取法,不新造通道)。 */
export function useActiveWorkspaceRoot(): string | null {
  const { list, activeId } = useWorkspaces();
  return (list.find((w) => w.id === activeId) ?? list[0])?.root ?? null;
}
