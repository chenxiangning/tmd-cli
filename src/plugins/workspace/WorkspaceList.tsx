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
import { clusterOrder, useWorktreeCluster } from "./useWorktreeCluster";

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
  /* worktree 归簇(方案 A):同仓卡的从属展示数据;非 git 目录无元数据原样。 */
  const flat = useMemo(
    () => [...grouped.ungrouped, ...grouped.named.flatMap(({ workspaces }) => workspaces)],
    [grouped],
  );
  const clusterMeta = useWorktreeCluster(flat.map((ws) => ws.root));
  /** 主仓卡头的「N 棵树」:同簇成员数(主仓自身缺卡时该簇不显示计数)。 */
  const treeCount = useMemo(() => {
    const count: Record<string, number> = {};
    for (const ws of flat) {
      const m = clusterMeta[ws.root];
      if (!m) continue;
      count[m.mainRoot] = (count[m.mainRoot] ?? 0) + 1;
    }
    return count;
  }, [flat, clusterMeta]);

  const renderCard = (ws: Workspace) => {
    const m = clusterMeta[ws.root];
    const card = (
      <WorkspaceCard
        key={ws.id}
        workspace={ws}
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
        cluster={m}
        treeCount={m?.isMain ? treeCount[m.mainRoot] : undefined}
      />
    );
    /* worktree 子卡缩进 + 左树形连线(主仓卡顶格)。 */
    if (m && !m.isMain) {
      return (
        <div
          key={`wt:${ws.id}`}
          className="ws-worktree-indent"
          style={{ marginLeft: 14, borderLeft: "2px solid var(--tmd-border)", paddingLeft: 6 }}
        >
          {card}
        </div>
      );
    }
    return card;
  };

  return (
    <>
      {clusterOrder(grouped.ungrouped.map((ws) => ({ ws, root: ws.root })), clusterMeta).map(
        ({ ws }) => renderCard(ws),
      )}
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
            {!collapsed &&
              clusterOrder(
                workspaces.map((ws) => ({ ws, root: ws.root })),
                clusterMeta,
              ).map(({ ws }) => renderCard(ws))}
          </div>,
        ];
      })}
    </>
  );
}
