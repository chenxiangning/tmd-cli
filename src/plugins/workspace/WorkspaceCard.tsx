/**
 * 单个工作区卡片(codemoss WorkspaceCard 复刻):行 + 折叠会话树。
 * 工作区行:双态文件夹图标(hover 换 chevrons)+ 名称 + Default badge
 *   + hover 显形动作组(切到主区/刷新会话/新建会话菜单),右键同「+」。
 */

import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { setActiveWorkspace, type Workspace } from "@kernel/workspace";
import { CaretDoubleDown, CaretDoubleUp, ArrowClockwise, FolderSimple, FolderOpen, RocketLaunch } from "@phosphor-icons/react";
import { CliSessionGroup } from "./SessionList";
import { SshSessionGroup } from "./SshSessionGroup";
import { ShellSessionGroup } from "./ShellSessionGroup";

/** 双态文件夹图标 —— 用 Phosphor 自带 FolderSimple(关闭)/FolderOpen(展开),
 *  bold weight 下圆胖 + 顶部翻开页细节。 */
function FolderIcon({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <FolderOpen size={16} weight="bold" aria-hidden />
  ) : (
    <FolderSimple size={16} weight="bold" aria-hidden />
  );
}

/** 单个工作区卡片(codemoss WorkspaceCard 复刻):行 + 折叠会话树。 */
export function WorkspaceCard({
  workspace,
  isActive,
  collapsed,
  onToggleCollapsed,
  refreshTicks,
  refreshing,
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
  /** 各工作区:CLI 扫描在途表 —— 本工作区任一 CLI 扫描中,行刷新按钮转圈。 */
  refreshing: Record<string, boolean>;
  onRefreshWorkspace: (workspaceId: string) => void;
  /** 组扫描完成上报:清菜单刷新按钮的 spin。 */
  onScanDone: (workspaceId: string, profileId: string) => void;
  onShowMenu: (workspace: Workspace, x: number, y: number) => void;
}) {
  const profiles = host.getCliProfiles();
  const scanKey = (profileId: string) => `${workspace.id}:${profileId}`;
  const rowRefreshing = profiles.some((p) => refreshing[scanKey(p.id)] ?? false);

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
            title={collapsed ? t("展开会话列表") : t("折叠会话列表")}
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
                <CaretDoubleUp size={14} strokeWidth={1.8} />
              ) : (
                <CaretDoubleDown size={14} strokeWidth={1.8} />
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
              className={`workspace-action-btn${rowRefreshing ? " is-refreshing" : ""}`}
              title={t("刷新会话")}
              onClick={(e) => {
                e.stopPropagation();
                onRefreshWorkspace(workspace.id);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <ArrowClockwise size={16} aria-hidden />
            </button>
            <button
              className="workspace-action-btn"
              title={t("新建会话")}
              onClick={(e) => {
                e.stopPropagation();
                onShowMenu(workspace, e.clientX, e.clientY);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <RocketLaunch size={15} weight="duotone" aria-hidden />
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
          <SshSessionGroup workspace={workspace} />
          <ShellSessionGroup workspace={workspace} />
        </div>
      </div>
    </div>
  );
}
