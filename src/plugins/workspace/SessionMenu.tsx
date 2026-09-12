/**
 * 新建会话下拉菜单(codemoss SidebarWorkspaceMenuOverlay 复刻):
 * portal + fixed 定位;CLI 行(icon + 名称 + 行右侧刷新);底部工作区操作组。
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { Mounts } from "@kernel/Mounts";
import { removeWorkspace, type Workspace } from "@kernel/workspace";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import { useSettingsState } from "@kernel/settings";
import { assignToGroup } from "./groups";
import { ArrowClockwise, Check, PencilSimple, Trash } from "@phosphor-icons/react";


/* 菜单定位夹取函数 clampMenuPosition 已迁至 ./utils(only-export-components:
 * 组件文件只导出组件),消费方:index.tsx / SessionContextMenu.tsx。 */

/**
 * 新建会话下拉菜单(codemoss SidebarWorkspaceMenuOverlay 复刻):
 * portal + fixed 定位;CLI 行(icon + 名称 + 行右侧刷新);底部工作区操作组。
 * 注:codemoss 的供应商子菜单(>)在 tmd-cli 无对应概念,省略不放死 chevron。
 */
export function SessionMenuOverlay({
  workspace,
  canRemove,
  position,
  refreshing,
  onRefresh,
  onRename,
  onClose,
}: {
  workspace: Workspace;
  canRemove: boolean;
  position: { x: number; y: number };
  refreshing: Record<string, boolean>;
  onRefresh: (profileId: string) => void;
  onRename: () => void;
  onClose: () => void;
}) {
  const profiles = host.getCliProfiles();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const { settings } = useSettingsState();
  const groups = settings.workspaceGroups;
  const currentGroupId = groups.some((g) => g.id === workspace.groupId) ? workspace.groupId! : null;
  /* 来源工作区(如远程 WSL)的引擎行过滤/提示/启动适配由来源插件贡献
     (workspaceOrigins 协议);未注册来源 = 全量引擎行 + 默认本地 spawn。 */
  const origin = findWorkspaceOrigin(workspace);
  const cliProfiles = origin?.filterCliProfiles?.(workspace, profiles) ?? profiles;
  const menuNote = origin?.sessionMenuNote?.(workspace) ?? null;

  return createPortal(
    <>
      {/* 透明背板:纯点外关闭,role=presentation 豁免静态元素交互规则 */}
      <div className="wsmenu-backdrop" role="presentation" onClick={onClose} />
      <div className="wsmenu" style={{ left: position.x, top: position.y }}>
        <div className="wsmenu-group-title">{origin?.newSessionLabel?.(workspace) ?? t("新建会话")}</div>
        {menuNote && <div className="wsmenu-note">{menuNote}</div>}
        {cliProfiles.map((p) => (
          <div className="wsmenu-item-row" key={p.id}>
            <button
              className="wsmenu-item"
              onClick={() => {
                /* 来源适配(远程 WSL:SSH 包装会话 + 引擎档案透传)优先接管;
                   spawn 被拒的原因已由内核广播 sessionStartFailed(toast),此处吞 rejection。 */
                if (origin?.spawnCliSession?.(workspace, p)) {
                  onClose();
                  return;
                }
                host.createSession(p.id, workspace.root, workspace.id).catch(() => undefined);
                onClose();
              }}
            >
              <span className="wsmenu-item-icon">{p.renderIcon?.(14)}</span>
              <span className="wsmenu-item-label">{p.name}</span>
            </button>
            <button
              className={`wsmenu-item-refresh${refreshing[p.id] ? " is-refreshing" : ""}`}
              title={t("刷新 {profile} 会话列表", { profile: p.name })}
              onClick={() => onRefresh(p.id)}
            >
              <ArrowClockwise />
            </button>
          </div>
        ))}

        {/* 扩展入口:插件贡献的会话类型(如 ssh 插件的「SSH 连接」)。 */}
        <Mounts point="workspace.newSessionMenu" />

        {/* 移动到组(codemoss assign-workspace-group 同款):仅存在组时出现,当前组打勾。 */}
        {groups.length > 0 && (
          <>
            <div className="wsmenu-divider" />
            <div className="wsmenu-group-title">{t("移动到组")}</div>
            {[{ id: null, name: t("未分组") }, ...groups].map((g) => (
              <button
                key={g.id ?? "ungrouped"}
                className="wsmenu-item"
                onClick={() => {
                  assignToGroup(workspace.id, g.id);
                  onClose();
                }}
              >
                <span className="wsmenu-item-icon">
                  {currentGroupId === (g.id ?? null) && <Check size="0.8125rem" />}
                </span>
                <span className="wsmenu-item-label">{g.name}</span>
              </button>
            ))}
          </>
        )}

        <div className="wsmenu-divider" />
        <div className="wsmenu-group-title">{t("工作区操作")}</div>
        <button
          className="wsmenu-item"
          onClick={onRename}
        >
          <span className="wsmenu-item-icon">
            <PencilSimple size="0.8125rem" />
          </span>
          <span className="wsmenu-item-label">{t("设置别名")}</span>
        </button>
        {canRemove && (
          <button
            className="wsmenu-item is-danger"
            onClick={() => {
              removeWorkspace(workspace.id);
              onClose();
            }}
          >
            <span className="wsmenu-item-icon">
              <Trash size="0.8125rem" />
            </span>
            <span className="wsmenu-item-label">{t("删除工作区")}</span>
          </button>
        )}
      </div>
    </>,
    document.body,
  );
}
