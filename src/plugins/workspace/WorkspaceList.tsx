/**
 * 侧栏工作区清单 —— 分组渲染(参考 codemoss Sidebar 段):
 * 未分组桶无头置顶,命名组按 settings 数组序跟随;组头 = 折叠箭头 + 组名
 * (无计数无右键),空组不渲染;组内照常渲染 WorkspaceCard。
 * 从 index.tsx 拆出(文件规模铁则);状态与刷新编排全部留在父组件,这里纯渲染。
 */

import type { Workspace } from "@kernel/workspace";
import { useMemo } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { WorkspaceCard } from "./WorkspaceCard";
import type { GroupedWorkspaces } from "./groups";
import { clusterBuckets, useWorktreeCluster } from "./useWorktreeCluster";

export function WorkspaceList({
  grouped,
  groupCollapsedMap,
  onToggleGroup,
  activeId,
  isCollapsed,
  onToggleCollapsed,
  renamingId,
  onRenameEnd,
  refreshTicks,
  refreshing,
  onRefreshWorkspace,
  onScanDone,
  onShowMenu,
}: {
  grouped: GroupedWorkspaces;
  groupCollapsedMap: Record<string, boolean>;
  onToggleGroup: (id: string) => void;
  activeId: string | null;
  isCollapsed: (id: string) => boolean;
  onToggleCollapsed: (id: string) => void;
  refreshTicks: Record<string, number>;
  refreshing: Record<string, boolean>;
  renamingId: string | null;
  onRenameEnd: () => void;
  onRefreshWorkspace: (wsId: string) => void;
  onScanDone: (workspaceId: string, profileId: string) => void;
  onShowMenu: (workspace: Workspace, x: number, y: number) => void;
}) {
  /* worktree 归簇(结构层):同仓卡分桶成簇,主仓 + worktree 卡平级共框,
   * 边框归组(2026-09-26 起弃父子缩进)。roots 引用必须钉住 ——
   * 传引用不稳的数组会让 effect 每渲染重跑(P0 卡死事故根因)。 */
  const flat = useMemo(
    () => [...grouped.ungrouped, ...grouped.named.flatMap(({ workspaces }) => workspaces)],
    [grouped],
  );
  const roots = useMemo(() => flat.map((ws) => ws.root), [flat]);
  const clusterMeta = useWorktreeCluster(roots);

  const renderCard = (ws: Workspace) => {
    const m = clusterMeta[ws.root];
    return (
      <WorkspaceCard
        key={ws.id}
        workspace={ws}
        worktree={!!m && !m.isMain}
        isActive={ws.id === activeId}
        collapsed={isCollapsed(ws.id)}
        onToggleCollapsed={() => onToggleCollapsed(ws.id)}
        renaming={renamingId === ws.id}
        onRenameEnd={onRenameEnd}
        refreshTicks={refreshTicks}
        refreshing={refreshing}
        onRefreshWorkspace={onRefreshWorkspace}
        onScanDone={onScanDone}
        onShowMenu={onShowMenu}
      />
    );
  };

  /* 簇渲染:仅「主仓 + worktree 同组可见」才成框;孤 worktree(主仓不在本组)
   * 平铺不框 —— fork 图标已标识身份,单卡框只会添乱(2026-09-26 二审)。 */
  const renderBuckets = (items: Workspace[]) =>
    clusterBuckets(
      items.map((ws) => ({ ws, root: ws.root })),
      clusterMeta,
    ).map((bucket) => {
      const cards = [...(bucket.main ? [bucket.main.ws] : []), ...bucket.children.map((c) => c.ws)];
      if (!bucket.main || bucket.children.length === 0) return cards.map(renderCard);
      return (
        <div className="ws-worktree-cluster" key={`wtc:${bucket.main.ws.id}`}>
          {/* 术语三语同形(zh/ja 词典原样保留 worktree),不做 i18n 键 */}
          <span className="ws-worktree-cluster-label" aria-hidden>
            worktree
          </span>
          {cards.map(renderCard)}
        </div>
      );
    });

  return (
    <>
      {renderBuckets(grouped.ungrouped)}
      {grouped.named.flatMap(({ group, workspaces }) => {
        if (workspaces.length === 0) return [];
        const collapsed = groupCollapsedMap[group.id] ?? false;
        return [
          <div className="ws-group" key={group.id}>
            <button
              type="button"
              className="ws-group-header"
              aria-expanded={!collapsed}
              onClick={() => onToggleGroup(group.id)}
            >
              {collapsed ? (
                <CaretRight size="0.6875rem" aria-hidden />
              ) : (
                <CaretDown size="0.6875rem" aria-hidden />
              )}
              <span className="ws-group-name">{group.name}</span>
            </button>
            {!collapsed && renderBuckets(workspaces)}
          </div>,
        ];
      })}
    </>
  );
}
