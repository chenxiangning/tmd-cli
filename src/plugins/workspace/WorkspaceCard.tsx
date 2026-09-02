/**
 * 单个工作区卡片(codemoss WorkspaceCard 复刻):行 + 折叠会话树。
 * 工作区行:双态文件夹图标(hover 换 chevrons)+ 名称 + Default badge
 *   + hover 显形动作组(切到主区/刷新会话/新建会话菜单),右键同「+」。
 */

import { host } from "@kernel/host";
import { setActiveWorkspace, type Workspace } from "@kernel/workspace";
import {
  ArrowRight,
  ListChevronsDownUp,
  ListChevronsUpDown,
  RefreshCw,
  SquarePlus,
} from "lucide-react";
import { CliSessionGroup } from "./SessionList";

/** 双态文件夹图标(codemoss WorkspaceCard 同源 SVG):展开=开口,收起=闭合。 */
function FolderIcon({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M5.5 11.5001L6.625 9.32507C6.7473 9.08218 6.93334 8.8771 7.16321 8.73178C7.39307 8.58646 7.65812 8.50637 7.93 8.50007H16M16 8.50007C16.2291 8.49967 16.4553 8.55177 16.6612 8.65238C16.8671 8.75299 17.0472 8.89944 17.1877 9.08047C17.3282 9.26151 17.4253 9.47232 17.4716 9.69674C17.518 9.92115 17.5123 10.1532 17.455 10.3751L16.3 14.8751C16.2164 15.1987 16.0272 15.4852 15.7622 15.689C15.4972 15.8929 15.1718 16.0023 14.8375 16.0001H4C3.60218 16.0001 3.22064 15.842 2.93934 15.5607C2.65804 15.2794 2.5 14.8979 2.5 14.5001V4.75007C2.5 4.35225 2.65804 3.97072 2.93934 3.68941C3.22064 3.40811 3.60218 3.25007 4 3.25007H6.925C7.17586 3.24761 7.42334 3.30811 7.64477 3.42604C7.86621 3.54396 8.05453 3.71554 8.1925 3.92507L8.8 4.82507C8.93658 5.03247 9.12252 5.20271 9.34113 5.32052C9.55973 5.43834 9.80417 5.50003 10.0525 5.50007H14.5C14.8978 5.50007 15.2794 5.65811 15.5607 5.93941C15.842 6.22072 16 6.60225 16 7.00007V8.50007Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M16 16C16.3978 16 16.7794 15.842 17.0607 15.5607C17.342 15.2794 17.5 14.8978 17.5 14.5V7C17.5 6.60218 17.342 6.22064 17.0607 5.93934C16.7794 5.65804 16.3978 5.5 16 5.5H10.075C9.82414 5.50246 9.57666 5.44196 9.35523 5.32403C9.13379 5.20611 8.94547 5.03453 8.8075 4.825L8.2 3.925C8.06342 3.7176 7.87748 3.54736 7.65887 3.42955C7.44027 3.31174 7.19583 3.25004 6.9475 3.25H4C3.60218 3.25 3.22064 3.40804 2.93934 3.68934C2.65804 3.97064 2.5 4.35218 2.5 4.75V14.5C2.5 14.8978 2.65804 15.2794 2.93934 15.5607C3.22064 15.842 3.60218 16 4 16H16Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.5 8.5H17.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 单个工作区卡片(codemoss WorkspaceCard 复刻):行 + 折叠会话树。 */
export function WorkspaceCard({
  workspace,
  isActive,
  collapsed,
  onToggleCollapsed,
  refreshTicks,
  onRefreshWorkspace,
  onScanDone,
  onShowMenu,
}: {
  workspace: Workspace;
  isActive: boolean;
  /** 折叠态由 WorkspaceSection 持有(受控):caption「折叠全部」按钮据此全局切换。 */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  refreshTicks: Record<string, number>;
  onRefreshWorkspace: (workspaceId: string) => void;
  /** 组扫描完成上报:清菜单刷新按钮的 spin。 */
  onScanDone: (workspaceId: string, profileId: string) => void;
  onShowMenu: (workspace: Workspace, x: number, y: number) => void;
}) {
  const profiles = host.getCliProfiles();
  const scanKey = (profileId: string) => `${workspace.id}:${profileId}`;

  return (
    <div className={`workspace-card${isActive ? " is-active" : ""}`}>
      <div
        className={`workspace-row${isActive ? " active" : ""}`}
        role="button"
        tabIndex={0}
        onClick={(e) => {
          if (e.detail > 1) return;
          setActiveWorkspace(workspace.id);
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          onToggleCollapsed();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onShowMenu(workspace, e.clientX, e.clientY);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setActiveWorkspace(workspace.id);
          }
        }}
      >
        <div className="workspace-header-content">
          <button
            type="button"
            className="workspace-folder-btn workspace-collapse-toggle"
            title={collapsed ? "展开会话列表" : "折叠会话列表"}
            aria-expanded={!collapsed}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapsed();
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <span className="workspace-collapse-toggle-folder-icon" aria-hidden>
              <FolderIcon expanded={!collapsed} />
            </span>
            <span className="workspace-collapse-toggle-affordance-icon" aria-hidden>
              {collapsed ? (
                <ListChevronsUpDown size={14} strokeWidth={1.8} />
              ) : (
                <ListChevronsDownUp size={14} strokeWidth={1.8} />
              )}
            </span>
          </button>

          <span className="workspace-name-text">{workspace.name}</span>
          {workspace.id === "default" && (
            <span className="default-workspace-badge" aria-label="Default Workspace">
              Default
            </span>
          )}

          <div className="workspace-actions">
            <button
              className="workspace-action-btn"
              title="设为当前工作区"
              onClick={(e) => {
                e.stopPropagation();
                setActiveWorkspace(workspace.id);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <ArrowRight size={16} aria-hidden />
            </button>
            <button
              className="workspace-action-btn"
              title="刷新会话"
              onClick={(e) => {
                e.stopPropagation();
                onRefreshWorkspace(workspace.id);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <RefreshCw size={16} aria-hidden />
            </button>
            <button
              className="workspace-action-btn"
              title="新建会话"
              onClick={(e) => {
                e.stopPropagation();
                onShowMenu(workspace, e.clientX, e.clientY);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <SquarePlus size={15} strokeWidth={1.85} aria-hidden />
            </button>
          </div>
        </div>
      </div>

      <div
        className={`workspace-children ${collapsed ? "is-collapsed" : "is-expanded"}`}
        aria-hidden={collapsed}
      >
        <div className="workspace-children-inner">
          {profiles.map((p) => (
            <CliSessionGroup
              key={p.id}
              profile={p}
              workspace={workspace}
              refreshTick={refreshTicks[scanKey(p.id)] ?? 0}
              onScanned={() => onScanDone(workspace.id, p.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
