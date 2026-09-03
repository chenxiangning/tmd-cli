/**
 * 新建会话下拉菜单(codemoss SidebarWorkspaceMenuOverlay 复刻):
 * portal + fixed 定位;CLI 行(icon + 名称 + 行右侧刷新);底部工作区操作组。
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { host } from "@kernel/host";
import { Mounts } from "@kernel/Mounts";
import { removeWorkspace, type Workspace } from "@kernel/workspace";
import { RefreshCw, Trash2 } from "lucide-react";

/** 新建会话菜单定位:以点击点为左上,按估算尺寸在视口内夹取(codemoss 同款)。 */
export function clampMenuPosition(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(x, window.innerWidth - 328 - 12),
    y: Math.min(y, window.innerHeight - 420 - 12),
  };
}

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
  onClose,
}: {
  workspace: Workspace;
  canRemove: boolean;
  position: { x: number; y: number };
  refreshing: Record<string, boolean>;
  onRefresh: (profileId: string) => void;
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

  return createPortal(
    <>
      <div className="wsmenu-backdrop" onClick={onClose} />
      <div className="wsmenu" style={{ left: position.x, top: position.y }}>
        <div className="wsmenu-group-title">新建会话</div>
        {profiles.map((p) => (
          <div className="wsmenu-item-row" key={p.id}>
            <button
              className="wsmenu-item"
              onClick={() => {
                void host.createSession(p.id, workspace.root, workspace.id);
                onClose();
              }}
            >
              <span className="wsmenu-item-icon">{p.renderIcon?.(14)}</span>
              <span className="wsmenu-item-label">{p.name}</span>
            </button>
            <button
              className={`wsmenu-item-refresh${refreshing[p.id] ? " is-refreshing" : ""}`}
              title={`刷新 ${p.name} 会话列表`}
              onClick={() => onRefresh(p.id)}
            >
              <RefreshCw />
            </button>
          </div>
        ))}

        {/* 扩展入口:插件贡献的会话类型(如 ssh 插件的「SSH 连接」)。 */}
        <Mounts point="workspace.newSessionMenu" />

        <div className="wsmenu-divider" />
        <div className="wsmenu-group-title">工作区操作</div>
        {canRemove && (
          <button
            className="wsmenu-item is-danger"
            onClick={() => {
              removeWorkspace(workspace.id);
              onClose();
            }}
          >
            <span className="wsmenu-item-icon">
              <Trash2 size={13} />
            </span>
            <span className="wsmenu-item-label">删除工作区</span>
          </button>
        )}
      </div>
    </>,
    document.body,
  );
}
