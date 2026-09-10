/**
 * 单个工作区卡片(codemoss WorkspaceCard 复刻):行 + 折叠会话树。
 * 工作区行:双态文件夹图标(hover 换 chevrons)+ 名称 + Default badge;
 * 行内动作(会话管理/刷新/新建/折叠)收进行尾 ⋯ 菜单 —— 激活热区(主按钮)
 * 与动作按钮 DOM 分离,消除嵌套交互(html-no-nested-interactive 治理)。
 */

import { useEffect, useState } from "react";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { setActiveWorkspace, setWorkspaceAlias, workspaceDisplayName, type Workspace } from "@kernel/workspace";
import { RenameInput } from "@kernel/RenameInput";
import { CaretDoubleDown, CaretDoubleUp, ArrowClockwise, FolderSimple, FolderOpen, RocketLaunch, ListChecks, DotsThree } from "@phosphor-icons/react";
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
  /** 各工作区:CLI 扫描在途表 —— 本工作区任一 CLI 扫描中,菜单刷新项转圈。 */
  refreshing: Record<string, boolean>;
  onRefreshWorkspace: (workspaceId: string) => void;
  /** 组扫描完成上报:清菜单刷新按钮的 spin。 */
  onScanDone: (workspaceId: string, profileId: string) => void;
  onShowMenu: (workspace: Workspace, x: number, y: number) => void;
}) {
  const profiles = host.getCliProfiles();
  const scanKey = (profileId: string) => `${workspace.id}:${profileId}`;
  const rowRefreshing = profiles.some((p) => refreshing[scanKey(p.id)] ?? false);
  /** 会话管理模式(本工作区全部 CLI 组统一切换,prop 下发);入口收编 ⋯ 菜单。 */
  const [manage, setManage] = useState(false);
  /** ⋯ 菜单开合;点外/Esc 关闭(document 级监听,同 NamePrompt 背板方案)。 */
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!moreOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest(".workspace-more-menu, .workspace-more-btn")) return;
      setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const closeMore = () => setMoreOpen(false);
  const openEngineMenu = (x: number, y: number) => {
    closeMore();
    onShowMenu(workspace, x, y);
  };

  return (
    <div className={`workspace-card${isActive ? " is-active" : ""}`}>
      <div
        className="workspace-row"
        onContextMenu={(e) => {
          e.preventDefault();
          onShowMenu(workspace, e.clientX, e.clientY);
        }}
      >
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
              <CaretDoubleUp size="0.875rem" strokeWidth={1.8} />
            ) : (
              <CaretDoubleDown size="0.875rem" strokeWidth={1.8} />
            )}
          </span>
        </button>

        {renaming ? (
          <span className="workspace-header-content workspace-row-main">
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
            className="workspace-header-content workspace-row-main"
            title={workspace.root}
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
            {workspace.id === "default" && (
              <span className="default-workspace-badge" aria-label="Default Workspace">
                Default
              </span>
            )}
          </button>
        )}

        <button
          type="button"
          className={`workspace-action-btn workspace-more-btn${moreOpen ? " is-on" : ""}`}
          title={t("工作区操作")}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          onClick={(e) => {
            e.stopPropagation();
            setMoreOpen((v) => !v);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <DotsThree size="0.9375rem" weight="bold" aria-hidden />
        </button>

        {moreOpen && (
          <div className="workspace-more-menu" role="menu" aria-label={t("工作区操作")}>
            <button
              type="button"
              role="menuitem"
              className={`workspace-more-item${manage ? " is-on" : ""}`}
              onClick={() => setManage((v) => !v)}
            >
              <ListChecks size="0.9375rem" aria-hidden />
              {t("会话管理")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="workspace-more-item"
              onClick={() => onRefreshWorkspace(workspace.id)}
            >
              <ArrowClockwise size="1rem" className={rowRefreshing ? "is-refreshing" : ""} aria-hidden />
              {t("刷新会话")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="workspace-more-item"
              onClick={(e) => openEngineMenu(e.clientX, e.clientY)}
            >
              <RocketLaunch size="0.9375rem" weight="duotone" aria-hidden />
              {t("新建会话")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="workspace-more-item"
              onClick={() => {
                closeMore();
                onToggleCollapsed();
              }}
            >
              {collapsed ? (
                <CaretDoubleUp size="0.9375rem" strokeWidth={1.8} aria-hidden />
              ) : (
                <CaretDoubleDown size="0.9375rem" strokeWidth={1.8} aria-hidden />
              )}
              {collapsed ? t("展开会话列表") : t("折叠会话列表")}
            </button>
          </div>
        )}
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
