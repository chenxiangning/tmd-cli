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
  /* worktree 归簇(方案 A,结构层):同仓卡排序成簇,worktree 子卡缩进;
   * 卡片本体零改动(徽章/计数已按主人要求撤除)。roots 引用必须钉住 ——
   * 传引用不稳的数组会让 effect 每渲染重跑(P0 卡死事故根因)。 */
  const flat = useMemo(
    () => [...grouped.ungrouped, ...grouped.named.flatMap(({ workspaces }) => workspaces)],
    [grouped],
  );
  const roots = useMemo(() => flat.map((ws) => ws.root), [flat]);
  const clusterMeta = useWorktreeCluster(roots);

  const renderCard = (ws: Workspace) => {
    const m = clusterMeta[ws.root];
    if (m && !m.isMain) {
      return (
        <div
          key={`wt:${ws.id}`}
          className="ws-worktree-indent"
          style={{ marginLeft: 14, borderLeft: "2px solid var(--tmd-border)", paddingLeft: 6 }}
        >
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
          />
        </div>
      );
    }
    return (
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
      />
    );
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
