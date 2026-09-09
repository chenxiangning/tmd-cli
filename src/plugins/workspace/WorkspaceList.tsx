/**
 * 侧栏工作区清单 —— 分组渲染(参考 codemoss Sidebar 段):
 * 未分组桶无头置顶,命名组按 settings 数组序跟随;组头 = 折叠箭头 + 组名
 * (无计数无右键),空组不渲染;组内照常渲染 WorkspaceCard。
 * 从 index.tsx 拆出(文件规模铁则);状态与刷新编排全部留在父组件,这里纯渲染。
 */

import type { Workspace } from "@kernel/workspace";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { WorkspaceCard } from "./WorkspaceCard";
import type { GroupedWorkspaces } from "./groups";

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
  const renderCard = (ws: Workspace) => (
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

  return (
    <>
      {grouped.ungrouped.map(renderCard)}
      {grouped.named
        .filter(({ workspaces }) => workspaces.length > 0)
        .map(({ group, workspaces }) => {
          const collapsed = groupCollapsedMap[group.id] ?? false;
          return (
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
              {!collapsed && workspaces.map(renderCard)}
            </div>
          );
        })}
    </>
  );
}
