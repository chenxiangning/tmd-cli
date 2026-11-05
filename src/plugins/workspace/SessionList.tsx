/**
 * 会话列表 —— 活会话行 + CLI 分组 + 磁盘历史分页。
 * 数据源:活会话 = 内核 PTY 注册表;历史 = 各 CLI 插件 listSessions。
 * RPC 会话(带渲染)不在引擎分组呈现:呈现面 = 工作区卡片的「带渲染的会话」
 * 小节(StructuredSessionSection,图 2 结构定稿);在册 RPC 会话的磁盘行让位
 * (isSsSessionTracked),未在册的历史行带「带渲染」徽标、点按 resume 重开
 * (R-ISO1);置顶投影/行菜单/管理拆子组件。
 */

import { useEffect } from "react";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { notePtyGroupVisible } from "./ptySectionVisibility";
import { sessionPinKey, toggleSessionPin, type SessionPinEntry, type SessionPinScope } from "@kernel/sessionPins";
import { openStructuredSessionTab } from "@kernel/structuredSessionTabs";
import { isClosedSsBusy } from "@kernel/structuredSessionEnded";
import { sessionTitleKey } from "@kernel/sessionTitles";
import type { SessionMeta } from "@kernel/ipc";
import type { Workspace } from "@kernel/workspace";
import { SessionContextMenu } from "./SessionContextMenu";
import { DiskSessionRow } from "./SessionRows";
import { LiveSessionRow, type MenuTarget } from "./LiveSessionRow";
import { useSessionGroupMenu } from "./sessionGroupMenu";
import { snapshotMenuHandler } from "./transcriptExportRun";
import { retryMenuHandler } from "./retryMenu";
import { useSnapshotExport } from "./transcriptExport";
import { ManageList } from "./SessionManage";
import { useCliSessionGroup } from "./useCliSessionGroup";
import { isRpcDiskSession, openDiskSessionEntry } from "./openDisk";
import type { ExportSessionTarget } from "@plugins/session-viewer/exportMd";
import { copyText } from "@kernel/clipboard";
import { PAGE_INITIAL } from "./utils";

interface SessionMenuContext {
  pins: Record<string, SessionPinEntry>;
  titleOverrides: Record<string, string>;
  displayTitle: (cliSessionId: string | undefined, fallbackId: string) => string;
  realTitle: (cliSessionId: string | undefined) => string | undefined;
  menuCliSessionId: string | undefined;
  menuPinKey: string | undefined;
  startRename: (cliSessionId: string, current: string) => void;
  deleteLive: (session: SessionMeta) => Promise<void>;
  deleteDisk: (session: CliDiskSession) => Promise<void>;
  setMenu: (menu: MenuTarget | null) => void;
  runSnapshotExport: (target: ExportSessionTarget) => void;
}

/** 菜单分支独立于组组件装配,行/菜单共用同一份标题与身份解析。 */
function sessionMenuProps(menu: MenuTarget, profile: CliProfile, workspace: Workspace, ctx: SessionMenuContext) {
  const { menuCliSessionId, menuPinKey } = ctx;
  const title = menu.kind === "disk"
    ? ctx.displayTitle(menu.session.id, menu.session.id)
    : ctx.displayTitle(menuCliSessionId ?? "", menu.session.id);
  return {
    position: { x: menu.x, y: menu.y },
    canRename: menuCliSessionId !== undefined,
    muteKey: menuPinKey,
    pinScope: menuPinKey === undefined ? undefined : (ctx.pins[menuPinKey]?.scope ?? null),
    onCopyId: () => void copyText(menuCliSessionId ?? menu.session.id).catch(() => undefined),
    onRename: () => {
      if (!menuCliSessionId) return;
      ctx.startRename(menuCliSessionId, ctx.titleOverrides[sessionTitleKey(profile.id, menuCliSessionId)] ?? "");
    },
    onPinScope: (scope: SessionPinScope) => {
      if (!menuPinKey || !menuCliSessionId) return;
      toggleSessionPin(menuPinKey, scope, ctx.realTitle(menuCliSessionId));
    },
    onExportSnapshot: menuCliSessionId === undefined
      ? undefined
      : menu.kind === "disk"
        ? () => ctx.runSnapshotExport({
            cliSessionId: menu.session.id,
            title,
            profileId: profile.id,
            path: menu.session.path,
            modifiedAt: menu.session.modifiedAt,
          })
        : snapshotMenuHandler(
            ctx.runSnapshotExport,
            menu.session,
            menuCliSessionId,
            title,
            profile.id,
            menu.session.cwd ?? workspace.root,
          ),
    /* 继续对话(带渲染):磁盘行 = 可重开 RPC 会话时出(判据与点按/徽标
     * 同源 isRpcDiskSession);PTY 磁盘行永不出现(R-ISO1)。 */
    onResumeRendered: menu.kind === "disk" && isRpcDiskSession(profile, workspace, menu.session)
      ? () => openStructuredSessionTab(profile.id, workspace.root, { resumeSessionId: menu.session.id, resumeUnsettled: isClosedSsBusy(menu.session.id) })
      : undefined,
    onRetry: menu.kind === "live" && menu.session.kind !== "cli"
      ? undefined
      : retryMenuHandler({
          sessionId: menu.kind === "live" ? menu.session.id : undefined,
          profileId: profile.id,
          engineName: profile.name,
          cliSessionId: menuCliSessionId,
          title,
          cwd: menu.kind === "live" ? (menu.session.cwd ?? workspace.root) : workspace.root,
          workspaceId: workspace.id,
        }),
    onDelete: () => {
      if (menu.kind === "live") void ctx.deleteLive(menu.session);
      else void ctx.deleteDisk(menu.session);
    },
    onClose: () => ctx.setMenu(null),
  };
}

/**
 * 单个 CLI 的会话分组 —— 工作区置顶块 + 活会话 + 磁盘历史分页。
 * 活会话 spawn/exit 改变 liveCount、外部 refreshTick 变化,均触发重扫。
 */
export function CliSessionGroup({
  profile,
  workspace,
  refreshTick,
  onScanned,
  manage,
}: {
  profile: CliProfile;
  workspace: Workspace;
  /** 外部刷新信号(工作区行刷新/菜单单项刷新):值变化即重扫。 */
  refreshTick: number;
  /** 扫描完成回调(驱动菜单刷新按钮的 spin 停止)。 */
  onScanned: () => void;
  /** 会话管理模式:工作区行「会话管理」开关统一切换(prop 下发,per-group ManageList)。 */
  manage: boolean;
}) {
  const {
    archivedView,
    isEmpty,
    sessions,
    setLimit,
    setRescanTick,
    titleOverrides,
    pins,
    activeSessionId,
    orderedLive,
    pinnedDisk,
    visible,
    remaining,
    realTitle,
    displayTitle,
  } = useCliSessionGroup({ profile, workspace, refreshTick, onScanned });
  const {
    menu, setMenu, renaming, commitRename, deleteLive, deleteDisk,
    startRename, togglePin, menuCliSessionId, menuPinKey,
  } = useSessionGroupMenu({ profile, workspace, sessions, setRescanTick, realTitle });
  const { run: runSnapshotExport, toast: snapshotToast } = useSnapshotExport();

  /** 磁盘行渲染契约:置顶块与分页历史共用同一份行装配(含菜单/重命名/扎点接线),仅 pinned 常亮差异。 */
  const renderDiskRows = (rows: CliDiskSession[], pinned: boolean) =>
    rows.map((s) => (
      <DiskSessionRow
        key={s.id}
        profile={profile}
        session={s}
        title={displayTitle(s.id, s.id)}
        pinned={pinned}
        archived={archivedView}
        /* RPC 身份徽标(R-ISO1 与 PTY 行可辨):判据与点按分流同源
           (isRpcDiskSession = tmd.ss.rpcids / tmd.ss.last 记忆)。 */
        rendered={isRpcDiskSession(profile, workspace, s)}
        renaming={renaming?.cliSessionId === s.id ? renaming : null}
        /* 打开出口统一:RPC 行 → 带渲染 resume;远程 → 来源插件;其余 → PTY。 */
        onOpen={() => openDiskSessionEntry(profile, workspace, s, displayTitle)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ kind: "disk", session: s, x: e.clientX, y: e.clientY });
        }}
        onRenameCommit={commitRename}
        onTogglePin={() => togglePin(s.id)}
        onCopyId={() => void copyText(s.id).catch(() => undefined)}
        onRename={() => startRename(s.id, titleOverrides[sessionTitleKey(profile.id, s.id)] ?? "")}
        onDelete={() => void deleteDisk(s)}
      />
    ));

  // 整组为空则不占位(默认视图:无活会话且磁盘历史加载完也为空;归档视图:无归档项);
  // 历史加载中(orderedLive 空且 sessions===null)同样不占位。
  const groupVisible = !isEmpty && !(orderedLive.length === 0 && sessions === null);
  /* 组可见性上报(PTY 小节头聚合):外部 store 写(ptySectionVisibility),
   * 不走 prop 回调 effect;卸载残留值由读侧 profiles 集合兜住。 */
  useEffect(() => {
    notePtyGroupVisible(profile.id, groupVisible);
  }, [groupVisible, profile.id]);
  if (!groupVisible) return null;

  return (
    <div className="cli-group">
      {manage ? (
        <ManageList
          key={archivedView ? "archived" : "default"}
          profile={profile}
          workspace={workspace}
          orderedLive={orderedLive}
          pinnedDisk={pinnedDisk}
          visible={visible}
          remaining={remaining}
          setLimit={setLimit}
          activeSessionId={activeSessionId}
          displayTitle={displayTitle}
          onDeleteLive={deleteLive}
          onDeleteDisk={deleteDisk}
        />
      ) : (
        <>
          {/* 工作区置顶块(置顶时间升序,行内扎点常亮) */}
          {renderDiskRows(pinnedDisk, true)}

          {/* 活会话(完成未读置顶,呼吸灯三态) */}
          {orderedLive.map((s) => {
            const cliSessionId = host.getCliSessionId(s.id);
            const title = displayTitle(cliSessionId, s.id);
            return (
              <LiveSessionRow
                key={s.id}
                profile={profile}
                session={s}
                isActive={s.id === activeSessionId}
                title={title}
                pinned={
                  cliSessionId !== undefined &&
                  sessionPinKey(workspace.id, profile.id, cliSessionId) in pins
                }
                canPin={cliSessionId !== undefined}
                cliSessionId={cliSessionId}
                waiting={host.isWaitingConfirm(s.id)}
                renaming={
                  renaming && cliSessionId === renaming.cliSessionId
                    ? renaming
                    : null
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ kind: "live", session: s, x: e.clientX, y: e.clientY });
                }}
                onTogglePin={() => {
                  if (cliSessionId !== undefined) togglePin(cliSessionId);
                }}
                onRenameCommit={commitRename}
                onCopyId={() => void copyText(cliSessionId ?? s.id).catch(() => undefined)}
                onRename={() => {
                  if (!cliSessionId) return;
                  startRename(
                    cliSessionId,
                    titleOverrides[sessionTitleKey(profile.id, cliSessionId)] ?? "",
                  );
                }}
                onDelete={() => void deleteLive(s)}
              />
            );
          })}

          {/* RPC 行不在引擎分组呈现:呈现面 = 工作区卡片的「带渲染的会话」小节
              (StructuredSessionSection,按 cwd 归属;图 2 结构定稿,2026-11-05);
              关闭会话经结束账本在小节存续,磁盘历史行让位。 */}

          {/* 磁盘历史(分页;已排除工作区置顶块与全局置顶) */}
          {renderDiskRows(visible, false)}

          {/* 分页:更多... → 翻倍(0 配额组首击从 PAGE_INITIAL 起步) */}
          {remaining > 0 && (
            <button
              className="thread-more"
              onClick={() => setLimit((l) => (l > 0 ? l * 2 : PAGE_INITIAL))}
            >
              {t("更多… (还有 {n} 条)", { n: remaining })}
            </button>
          )}
        </>
      )}

      {/* 行右键菜单 */}
      {snapshotToast}
      {menu && (
        <SessionContextMenu
          {...sessionMenuProps(menu, profile, workspace, {
            pins, titleOverrides, displayTitle, realTitle,
            menuCliSessionId, menuPinKey, startRename,
            deleteLive, deleteDisk, setMenu, runSnapshotExport,
          })}
        />
      )}
    </div>
  );
}
