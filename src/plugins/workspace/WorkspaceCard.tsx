/**
 * 单个工作区卡片(codemoss WorkspaceCard 复刻):行 + 折叠会话树。
 * 工作区行:双态文件夹图标(hover 换 chevrons)+ 名称 + Default badge
 *   + hover 显形动作组(会话管理/刷新会话/新建会话),右键同「+」。
 * 嵌套交互治理:激活热区(workspace-row-main)与折叠钮/动作组是 DOM 兄弟
 * (全真 button,行容器不再是 role=button 大热区),hover 显形走行级选择器。
 */

import { useState } from "react";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { setActiveWorkspace, setWorkspaceAlias, workspaceDisplayName, type Workspace } from "@kernel/workspace";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import { RenameInput } from "@kernel/RenameInput";
import { CaretDoubleDown, CaretDoubleUp, ArrowClockwise, FolderSimple, FolderOpen, RocketLaunch, ListChecks } from "@phosphor-icons/react";
import { CliSessionGroup } from "./SessionList";
import { SshSessionGroup } from "./SshSessionGroup";
import { ShellSessionGroup } from "./ShellSessionGroup";

/** 双态文件夹图标 —— 用 Phosphor 自带 FolderSimple(关闭)/FolderOpen(展开),
 *  bold weight 下圆胖 + 顶部翻开页细节。 */
function FolderIcon({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <FolderOpen size="1rem" weight="bold" aria-hidden />
  ) : (
    <FolderSimple size="1rem" weight="bold" aria-hidden />
  );
}

/** 单个工作区卡片(codemoss WorkspaceCard 复刻):行 + 折叠会话树。 */
export function WorkspaceCard({
  workspace,
  isActive,
  collapsed,
  onToggleCollapsed,
  refreshTicks,
  renaming,
  onRenameEnd,
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
  /** 行内别名重命名态(父级 WorkspaceSection 受控单例)。 */
  renaming: boolean;
  onRenameEnd: () => void;
  refreshTicks: Record<string, number>;
  /** 各工作区:CLI 扫描在途表 —— 本工作区任一 CLI 扫描中,行刷新按钮转圈。 */
  refreshing: Record<string, boolean>;
  onRefreshWorkspace: (workspaceId: string) => void;
  /** 组扫描完成上报:清行刷新按钮的 spin。 */
  onScanDone: (workspaceId: string, profileId: string) => void;
  onShowMenu: (workspace: Workspace, x: number, y: number) => void;
}) {
  const profiles = host.getCliProfiles();
  const scanKey = (profileId: string) => `${workspace.id}:${profileId}`;
  const rowRefreshing = profiles.some((p) => refreshing[scanKey(p.id)] ?? false);
  /** 会话管理模式(本工作区全部 CLI 组统一切换,prop 下发);入口 = 行头开关(归档视图入口在 caption「默认|归档」radio)。 */
  const [manage, setManage] = useState(false);
  return (
    <div className={`workspace-card${isActive ? " is-active" : ""}`}>
      <div className={`workspace-row${isActive ? " active" : ""}`}>
        <div className="workspace-header-content">
          <button
            type="button"
            className="workspace-folder-btn workspace-collapse-toggle"
            title={collapsed ? t("展开会话列表") : t("折叠会话列表")}
            aria-expanded={!collapsed}
            onContextMenu={(e) => {
              e.preventDefault();
              onShowMenu(workspace, e.clientX, e.clientY);
            }}
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
                <CaretDoubleUp size="0.875rem" strokeWidth={1.8} />
              ) : (
                <CaretDoubleDown size="0.875rem" strokeWidth={1.8} />
              )}
            </span>
          </button>

          {renaming ? (
            <span className="workspace-header-content-inner">
              <RenameInput
                target={{ current: workspaceDisplayName(workspace) }}
                placeholder={t("别名(留空清除)")}
                onCommit={(value) => {
                  if (value !== null) setWorkspaceAlias(workspace.id, value);
                  onRenameEnd();
                }}
              />
            </span>
          ) : (
            <button
              type="button"
              className="workspace-row-main"
              title={workspace.root}
              onContextMenu={(e) => {
                e.preventDefault();
                onShowMenu(workspace, e.clientX, e.clientY);
              }}
              onClick={(e) => {
                if (e.detail > 1) return;
                setActiveWorkspace(workspace.id);
              }}
              onDoubleClick={(e) => {
                e.preventDefault();
                onToggleCollapsed();
              }}
            >
              <span className="workspace-name-text" title={workspace.root}>
                {workspaceDisplayName(workspace)}
              </span>
              {(() => {
                /* 来源徽章(如 WSL)由来源插件经 workspaceOrigins 贡献,拔插件即消失 */
                const badge = findWorkspaceOrigin(workspace)?.badge?.(workspace);
                return badge ? (
                  <span className="workspace-origin-badge" title={badge.title}>
                    {t(badge.text)}
                  </span>
                ) : null;
              })()}
            </button>
          )}
          {workspace.id === "default" && !renaming && (
            <span className="default-workspace-badge" aria-label="Default Workspace">
              Default
            </span>
          )}
        </div>


        <div className="workspace-actions">
          <button
            type="button"
            className={`workspace-action-btn${manage ? " is-on" : ""}`}
            title={t("会话管理")}
            aria-pressed={manage}
            onClick={(e) => {
              e.stopPropagation();
              setManage((v) => !v);
            }}
          >
            <ListChecks size="0.9375rem" aria-hidden />
          </button>
          <button
            type="button"
            className={`workspace-action-btn${rowRefreshing ? " is-refreshing" : ""}`}
            title={t("刷新会话")}
            onClick={(e) => {
              e.stopPropagation();
              onRefreshWorkspace(workspace.id);
            }}
          >
            <ArrowClockwise size="1rem" aria-hidden />
          </button>
          <button
            type="button"
            className="workspace-action-btn is-newchat"
            title={t("新建会话")}
            onClick={(e) => {
              e.stopPropagation();
              onShowMenu(workspace, e.clientX, e.clientY);
            }}
          >
            <RocketLaunch size="0.9375rem" weight="duotone" aria-hidden />
          </button>
        </div>
      </div>

      <div
        className={`workspace-children ${collapsed ? "is-collapsed" : "is-expanded"}`}
        aria-hidden={collapsed}
        inert={collapsed}
      >
        <div className="workspace-children-inner">
          {profiles.map((p) => (
            <CliSessionGroup
              key={p.id}
              profile={p}
              workspace={workspace}
              refreshTick={refreshTicks[scanKey(p.id)] ?? 0}
              manage={manage}
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
