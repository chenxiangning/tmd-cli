/**
 * 运行区 —— 侧栏「已置顶」与「工作区」之间的自动聚集段(2026-09-07 用户定向):
 * 活会话中 运行中 / 结束未查看 的会话跨工作区自动汇入,已查看即自动回工作区
 * 分组 —— 一个会话同一时刻只在一个区域显示(工作区侧离组过滤见
 * useCliSessionGroup 的 zoneOut,成员判定同源 utils.isRunningZoneCandidate)。
 *
 * 与全局置顶区(PinnedSessions)的分工:
 * - 置顶优先级最高:任一作用域置顶的会话不进运行区(已置顶区/组内置顶块承载);
 * - 归档会话全域隐藏(与全局置顶区同口径);
 * - 本区纯自动投影,无持久态:成员资格完全由内核 activityWatch 状态派生,
 *   段折叠是唯一 UI 态(localStorage,同全局置顶区)。
 *
 * 行标题:手动命名 > 磁盘原生标题(候选 (工作区,CLI) 对聚合扫描,缺标题时
 * 指数退避补扫兜自动命名晚于文件出生)> 短码。行点击切到该活会话;右键菜单无删除项
 * (删除回工作区分组操作,同全局置顶区口径);行内扎点或菜单置顶即离开本区。
 */

import { useEffect, useRef, useState } from "react";
import type { CliProfile } from "@kernel/cli";
import { host, useHost } from "@kernel/host";
import type { SessionMeta } from "@kernel/ipc";
import { useSettingsState } from "@kernel/settings";
import { t } from "@kernel/i18n";
import { isSessionArchived, sessionArchiveKey } from "@kernel/sessionArchive";
import { isSessionDeleted, sessionDeletedKey } from "@kernel/sessionDeleted";
import { pinSession, sessionPinKey, toggleSessionPin, unpinSession } from "@kernel/sessionPins";
import { getSessionBaseline, noteSessionTabTitle } from "@kernel/sessionTabs";
import { sessionTitleKey, setSessionTitle } from "@kernel/sessionTitles";
import { useWorkspaces, workspaceDisplayName, type Workspace } from "@kernel/workspace";
import { Pulse, CaretDown, CaretRight } from "@phosphor-icons/react";
import { RenameInput, type RenameTarget } from "@kernel/RenameInput";
import { SessionContextMenu } from "./SessionContextMenu";
import { PinToggle, SessionStatusLabel } from "./SessionRows";
import {
  compareLiveSessions,
  isRunningZoneCandidate,
  orShortId,
  TITLE_RESOLVE_MAX_ATTEMPTS,
  titleRetryDelay,
} from "./utils";
import { runningSection } from "./sectionCollapsed";

interface RunningRow {
  session: SessionMeta;
  cliSessionId?: string;
  workspace: Workspace;
  profile: CliProfile;
}

export function RunningZoneSection() {
  useHost();
  const { list: workspaces } = useWorkspaces();
  const { settings } = useSettingsState();
  const collapsed = runningSection.use();
  const [menu, setMenu] = useState<{ row: RunningRow; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);

  const profiles = host.getCliProfiles();
  const rows: RunningRow[] = host
    .getSessions()
    .flatMap((session) => {
      const workspace = workspaces.find((w) => w.id === session.workspaceId);
      const profile = profiles.find((p) => p.id === session.profileId);
      if (!workspace || !profile) return [];
      const cliSessionId = host.getCliSessionId(session.id);
      if (cliSessionId !== undefined) {
        // 置顶优先:任一作用域置顶不进运行区;归档/删除(tombstone)会话全域隐藏
        if (
          sessionPinKey(workspace.id, profile.id, cliSessionId) in
          settings.sessionPins
        )
          return [];
        if (isSessionArchived(sessionArchiveKey(workspace.id, profile.id, cliSessionId)))
          return [];
        if (isSessionDeleted(sessionDeletedKey(workspace.id, profile.id, cliSessionId)))
          return [];
      }
      return isRunningZoneCandidate(
        host.isTurnActive(session.id),
        host.isUnread(session.id),
      )
        ? [{ session, cliSessionId, workspace, profile }]
        : [];
    })
    .sort((a, b) =>
      compareLiveSessions(a.session, b.session, (id) => host.isUnread(id)),
    );

  /* 磁盘原生标题缓存:有行缺真标题才按指数退避补扫,全部落定即停(三处锁步见 utils)。 */
  const [diskTitles, setDiskTitles] = useState<Record<string, string>>({});
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const missingTitleSig = rows
    .filter(
      (r) =>
        r.cliSessionId !== undefined &&
        r.profile.listSessions !== undefined &&
        diskTitles[r.cliSessionId] === undefined &&
        settings.sessionTitles[sessionTitleKey(r.profile.id, r.cliSessionId)] === undefined,
    )
    .map((r) => r.cliSessionId).join("|");
  useEffect(() => {
    if (!missingTitleSig) return;
    let stale = false;
    let attempts = 0;
    let timer: number | undefined;
    const scan = () => {
      const pairs = new Map<string, { profile: CliProfile; root: string }>();
      for (const r of rowsRef.current) {
        if (r.cliSessionId === undefined || !r.profile.listSessions) continue;
        pairs.set(`${r.workspace.id}:${r.profile.id}`, { profile: r.profile, root: r.workspace.root });
      }
      void Promise.all(
        [...pairs.values()].map(({ profile, root }) => profile.listSessions!(root).catch(() => [])),
      ).then((lists) => {
        if (stale) return;
        const next: Record<string, string> = {};
        for (const list of lists) {
          for (const d of list) if (d.title) next[d.id] = d.title;
        }
        setDiskTitles(next);
        /* 真标题落定随手喂 tab 快照:tab 标签跟随自动命名(手动命名优先,不受影响) */
        for (const r of rowsRef.current)
          if (r.cliSessionId !== undefined && next[r.cliSessionId])
            noteSessionTabTitle(r.session.id, next[r.cliSessionId]);
        attempts += 1;
        if (attempts < TITLE_RESOLVE_MAX_ATTEMPTS)
          timer = window.setTimeout(scan, titleRetryDelay(attempts));
      });
    };
    scan();
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [missingTitleSig]);

  if (rows.length === 0) return null;

  const toggleCollapsed = () => runningSection.set(!collapsed);

  /** 行标题:手动命名 > 磁盘原生标题 > 首条用户消息保底 > 短码(与分组/置顶区锁步)。 */
  const titleOf = (row: RunningRow): string =>
    orShortId(
      (row.cliSessionId !== undefined
        ? settings.sessionTitles[sessionTitleKey(row.profile.id, row.cliSessionId)] ??
          diskTitles[row.cliSessionId]
        : undefined) ?? getSessionBaseline(row.session.id),
      row.cliSessionId,
      row.session.id,
    );

  /** 置顶快照真标题(手动命名 > 磁盘原生标题,无短码兜底 —— pinSession 铁律)。 */
  const realTitleOf = (row: RunningRow): string | undefined =>
    row.cliSessionId === undefined
      ? undefined
      : settings.sessionTitles[sessionTitleKey(row.profile.id, row.cliSessionId)] ??
        diskTitles[row.cliSessionId];

  /** 行内扎点:本区行按定义未置顶(离组过滤已排除),点击即置顶到全局。 */
  const togglePin = (row: RunningRow) => {
    if (row.cliSessionId === undefined) return;
    const key = sessionPinKey(row.workspace.id, row.profile.id, row.cliSessionId);
    if (key in settings.sessionPins) unpinSession(key);
    else pinSession(key, "global", realTitleOf(row));
  };

  const openRow = (row: RunningRow) => {
    noteSessionTabTitle(row.session.id, titleOf(row));
    host.setActiveSession(row.session.id);
  };

  const commitRename = (value: string | null) => {
    if (renaming && value !== null) {
      setSessionTitle(renaming.profileId, renaming.cliSessionId, value);
    }
    setRenaming(null);
  };

  return (
    <div className="running-zone" data-running-section="">
      <button
        type="button"
        className={`running-zone-header${collapsed ? " is-collapsed" : ""}`}
        aria-expanded={!collapsed}
        title={collapsed ? t("展开运行区") : t("收起运行区")}
        onClick={toggleCollapsed}
      >
        <Pulse size="0.6875rem" className="pinned-sessions-header-icon" />
        <span className="running-zone-header-label">{t("运行区")}</span>
        <span className="pinned-sessions-header-count">· {rows.length}</span>
        {collapsed ? (
          <CaretRight size="0.75rem" className="pinned-sessions-header-chevron" aria-hidden />
        ) : (
          <CaretDown size="0.75rem" className="pinned-sessions-header-chevron" aria-hidden />
        )}
      </button>

      {!collapsed &&
        rows.map((row) => {
          const isActive = row.session.id === host.getActiveSessionId();
          if (
            renaming &&
            renaming.profileId === row.profile.id &&
            renaming.cliSessionId === row.cliSessionId
          ) {
            return (
              <div key={row.session.id} className="thread-row is-renaming">
                <span className="thread-engine-badge" title={row.profile.name}>
                  {row.profile.renderIcon?.("0.75rem")}
                </span>
                <RenameInput target={renaming} onCommit={commitRename} />
              </div>
            );
          }
          return (
            <span className="thread-row-host" key={row.session.id}>
              <button
                data-session-id={row.session.id}
                className={`thread-row${isActive ? " active" : ""}`}
                title={t("{workspace} · {profile} 会话 {id}", { workspace: workspaceDisplayName(row.workspace), profile: row.profile.name, id: row.cliSessionId ?? row.session.id })}
                onClick={() => openRow(row)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ row, x: e.clientX, y: e.clientY });
                }}
              >
                <span className="thread-engine-badge" title={row.profile.name}>
                  {row.profile.renderIcon?.("0.75rem")}
                </span>
                <span className="thread-name">{titleOf(row)}</span>
                <span className="thread-meta">
                  <SessionStatusLabel sessionId={row.session.id} />
                  {host.isWaitingConfirm(row.session.id) ? (
                    <span className="thread-ask-badge">{t("等待确认")}</span>
                  ) : null}
                  <span className="thread-time">{workspaceDisplayName(row.workspace)}</span>
                </span>
              </button>
              <PinToggle
                on={false}
                disabled={row.cliSessionId === undefined}
                onToggle={() => togglePin(row)}
              />
            </span>
          );
        })}

      {menu && (
        <SessionContextMenu
          position={{ x: menu.x, y: menu.y }}
          canRename={menu.row.cliSessionId !== undefined}
          pinScope={
            menu.row.cliSessionId === undefined
              ? undefined
              : (settings.sessionPins[
                  sessionPinKey(
                    menu.row.workspace.id,
                    menu.row.profile.id,
                    menu.row.cliSessionId,
                  )
                ]?.scope ?? null)
          }
          onCopyId={() => {
            void navigator.clipboard
              ?.writeText(menu.row.cliSessionId ?? menu.row.session.id)
              .catch(() => undefined);
          }}
          onRename={() => {
            if (menu.row.cliSessionId === undefined) return;
            setRenaming({
              profileId: menu.row.profile.id,
              cliSessionId: menu.row.cliSessionId,
              current:
                settings.sessionTitles[
                  sessionTitleKey(menu.row.profile.id, menu.row.cliSessionId)
                ] ?? "",
            });
          }}
          onPinScope={(scope) => {
            if (menu.row.cliSessionId === undefined) return;
            toggleSessionPin(
              sessionPinKey(
                menu.row.workspace.id,
                menu.row.profile.id,
                menu.row.cliSessionId,
              ),
              scope,
              titleOf(menu.row),
            );
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
