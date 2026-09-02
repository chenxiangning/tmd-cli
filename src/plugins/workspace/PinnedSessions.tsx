/**
 * 全局置顶区 —— 左侧栏顶部「已置顶」:跨工作区汇总 scope=global 的置顶会话。
 *
 * codemoss PinnedThreadList 适配:
 * - 平铺列表按置顶时间升序(tmd-cli 置顶规模小,不做 codemoss 的日历日分组);
 * - 段折叠态持久化 localStorage(纯 UI 态,不污染 settings schema);
 * - 行标题:手动命名覆盖层 > 置顶时刻标题快照 > 短码(快照让全局区免磁盘扫描);
 * - 行点击:绑定的活会话 → 切到该会话;否则按原工作区恢复磁盘会话;
 * - 已移除工作区/未注册 CLI 的残留置顶不渲染(数据保留,加回即恢复);
 * - 右键菜单无删除项:全局区不持有磁盘文件路径,删除回工作区分组操作
 *   (先「置顶到工作区内」迁移回组,或「取消置顶」后组内删除)。
 */

import { useState } from "react";
import type { CliProfile } from "@kernel/cli";
import { host, useHost } from "@kernel/host";
import { useSettingsState } from "@kernel/settings";
import {
  listSessionPins,
  toggleSessionPin,
  type SessionPinEntry,
} from "@kernel/sessionPins";
import { sessionTitleKey, setSessionTitle } from "@kernel/sessionTitles";
import { useWorkspaces, type Workspace } from "@kernel/workspace";
import { ChevronDown, ChevronRight, Pin } from "lucide-react";
import { SessionContextMenu } from "./SessionContextMenu";
import { RenameInput, type RenameTarget } from "./SessionRows";
import { shortId } from "./utils";

/** 段折叠态存储 key(纯 UI 态,localStorage 即可,浏览器/Tauri 行为一致)。 */
const COLLAPSED_KEY = "tmd.pinnedSectionCollapsed";

/** 解析成功的全局置顶行:身份 + 所属工作区/CLI 均已就位。 */
interface PinnedRow {
  key: string;
  entry: SessionPinEntry;
  cliSessionId: string;
  workspace: Workspace;
  profile: CliProfile;
}

export function PinnedSessionsSection() {
  useHost();
  const { list: workspaces } = useWorkspaces();
  const { settings } = useSettingsState();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === "1",
  );
  const [menu, setMenu] = useState<{ row: PinnedRow; x: number; y: number } | null>(
    null,
  );
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);

  const profiles = host.getCliProfiles();
  const rows: PinnedRow[] = listSessionPins(settings.sessionPins, {
    scope: "global",
  }).flatMap((pin) => {
    const workspace = workspaces.find((w) => w.id === pin.workspaceId);
    const profile = profiles.find((p) => p.id === pin.profileId);
    return workspace && profile
      ? [{ key: pin.key, entry: pin.entry, cliSessionId: pin.cliSessionId, workspace, profile }]
      : [];
  });

  if (rows.length === 0) return null;

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
  };

  /** 行标题:手动命名 > 置顶时刻快照 > 短码。 */
  const titleOf = (row: PinnedRow): string =>
    settings.sessionTitles[sessionTitleKey(row.profile.id, row.cliSessionId)] ??
    (row.entry.title || shortId(row.cliSessionId));

  /** 绑定的活会话(同工作区 + 同 CLI + 同磁盘身份);存在则点击 = 切会话。 */
  const liveOf = (row: PinnedRow) =>
    host
      .getSessions()
      .find(
        (s) =>
          s.workspaceId === row.workspace.id &&
          s.profileId === row.profile.id &&
          host.getCliSessionId(s.id) === row.cliSessionId,
      );

  const openRow = (row: PinnedRow) => {
    const live = liveOf(row);
    if (live) {
      host.setActiveSession(live.id);
      return;
    }
    void host.openDiskSession(
      row.profile.id,
      row.workspace.root,
      row.workspace.id,
      row.cliSessionId,
    );
  };

  const commitRename = (value: string | null) => {
    if (renaming && value !== null) {
      setSessionTitle(renaming.profileId, renaming.cliSessionId, value);
    }
    setRenaming(null);
  };

  return (
    <div className="pinned-sessions" data-pinned-section="">
      <button
        type="button"
        className={`pinned-sessions-header${collapsed ? " is-collapsed" : ""}`}
        aria-expanded={!collapsed}
        title={collapsed ? "展开已置顶" : "收起已置顶"}
        onClick={toggleCollapsed}
      >
        <Pin size={11} className="pinned-sessions-header-icon" aria-hidden />
        <span className="pinned-sessions-header-label">已置顶</span>
        <span className="pinned-sessions-header-count">· {rows.length}</span>
        {collapsed ? (
          <ChevronRight size={12} className="pinned-sessions-header-chevron" aria-hidden />
        ) : (
          <ChevronDown size={12} className="pinned-sessions-header-chevron" aria-hidden />
        )}
      </button>

      {!collapsed &&
        rows.map((row) => {
          const live = liveOf(row);
          const isActive = live !== undefined && live.id === host.getActiveSessionId();
          if (
            renaming &&
            renaming.profileId === row.profile.id &&
            renaming.cliSessionId === row.cliSessionId
          ) {
            return (
              <div key={row.key} className="thread-row is-renaming">
                <span className="thread-engine-badge" title={row.profile.name}>
                  {row.profile.renderIcon?.(12)}
                </span>
                <RenameInput target={renaming} onCommit={commitRename} />
              </div>
            );
          }
          return (
            <button
              key={row.key}
              className={`thread-row${isActive ? " active" : ""}`}
              title={`${row.workspace.name} · ${row.profile.name} 会话 ${row.cliSessionId}`}
              onClick={() => openRow(row)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ row, x: e.clientX, y: e.clientY });
              }}
            >
              <span className="thread-engine-badge" title={row.profile.name}>
                {row.profile.renderIcon?.(12)}
              </span>
              <span className="thread-name">{titleOf(row)}</span>
              <span className="thread-meta">
                <span className="thread-time">{row.workspace.name}</span>
                <Pin size={11} className="thread-pin-icon" aria-hidden />
              </span>
            </button>
          );
        })}

      {menu && (
        <SessionContextMenu
          position={{ x: menu.x, y: menu.y }}
          canRename
          pinScope="global"
          onCopyId={() => {
            void navigator.clipboard
              ?.writeText(menu.row.cliSessionId)
              .catch(() => undefined);
          }}
          onRename={() =>
            setRenaming({
              profileId: menu.row.profile.id,
              cliSessionId: menu.row.cliSessionId,
              current:
                settings.sessionTitles[
                  sessionTitleKey(menu.row.profile.id, menu.row.cliSessionId)
                ] ?? "",
            })
          }
          onPinScope={(scope) =>
            toggleSessionPin(menu.row.key, scope, titleOf(menu.row))
          }
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
