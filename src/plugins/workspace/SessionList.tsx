/**
 * 会话列表 —— 活会话行 + CLI 分组 + 磁盘历史分页。
 * 数据源:活会话 = 内核 PTY 注册表;历史 = 各 CLI 插件 listSessions。
 *
 * 状态表达(kernel host 活动守望结算,见 kernel/host.ts / activityWatch.ts;
 * 呼吸灯锚定用户首写 —— 首写前的一切输出(spawn 横幅/resume 回放/TUI 重绘)
 * 不亮灯、不结算未读,见 activityWatch 首写闸):
 * - 左侧节点:绿呼吸(对话中) / 蓝呼吸(完成未读) / 灰静止;正在查看的
 *   会话圆点让位给 Eye 图标,切走/关闭还原(SessionNode)
 * - meta 区状态 label(SessionStatusLabel):运行时 / 会话结束-未查看 /
 *   会话结束-已查看;从未对话不出签,磁盘行无此概念
 * 行右键菜单:复制 Session ID / 重命名(应用侧覆盖层,见 kernel/sessionTitles.ts)
 * / 置顶到全局 / 置顶到工作区内(双作用域,见 kernel/sessionPins.ts)
 * / 删除会话(两步确认,双端统一物理删除磁盘 jsonl)。
 *
 * 置顶投影(codemoss useThreadRows 三分适配):
 * - scope=workspace → 固定在 CLI 分组顶部(置顶时间升序),不参与分页;
 * - scope=global → 离开本组,汇入左侧栏顶部「已置顶」区(PinnedSessions.tsx);
 * - 未置顶 → 常规分页。scope=global 的活会话同样离组(仅全局区可见)。
 *
 * 活会话行与磁盘删除助手拆至 LiveSessionRow.tsx,分组数据装配拆至
 * useCliSessionGroup.ts(文件规模铁则)。
 * 扁平化(2026-09-08 spec):分组段头与折叠退役,会话行直接平铺于工作区下,
 * 行首供应商图标区分引擎;分组仅作数据装配边界(分页/置顶投影/归档过滤)。
 */

import { useState } from "react";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import type { SessionMeta } from "@kernel/ipc";
import {
  isSessionPinned,
  pinSession,
  sessionPinKey,
  toggleSessionPin,
  unpinSession,
} from "@kernel/sessionPins";
import { noteSessionTabTitle } from "@kernel/sessionTabs";
import { sessionTitleKey, setSessionTitle } from "@kernel/sessionTitles";
import type { Workspace } from "@kernel/workspace";
import { SessionContextMenu } from "./SessionContextMenu";
import type { RenameTarget } from "@kernel/RenameInput";
import { DiskSessionRow } from "./SessionRows";
import { LiveSessionRow, type MenuTarget } from "./LiveSessionRow";
import { deleteDiskSessionFull, deleteLiveSessionFull } from "./sessionOps";
import { ManageList } from "./SessionManage";
import { useCliSessionGroup } from "./useCliSessionGroup";

import { PAGE_INITIAL } from "./utils";

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
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);

  const copyText = (text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  /** 重命名提交:null=取消;空串=清除命名回归磁盘标题。 */
  const commitRename = (value: string | null) => {
    if (renaming && value !== null) {
      setSessionTitle(profile.id, renaming.cliSessionId, value);
    }
    setRenaming(null);
  };

  /** 删除入口:物理删除 + 清命名/置顶覆盖层(语义见 sessionOps);
   *  磁盘删除再触发本地重扫(活删除经 removeSession 的 liveCount 变化自然重扫)。 */
  const deleteLive = (session: SessionMeta) =>
    deleteLiveSessionFull(profile, session, workspace.id, workspace.root, sessions ?? []);
  const deleteDisk = (session: CliDiskSession) =>
    deleteDiskSessionFull(profile, session, workspace.id).then(() =>
      setRescanTick((t) => t + 1),
    );

  const startRename = (cliSessionId: string, current: string) => {
    setRenaming({ profileId: profile.id, cliSessionId, current });
  };

  /**
   * 行内扎点开关:未扎 → 置顶到全局;已扎(任一作用域)→ 取消置顶。
   * 跨作用域迁移仍走右键菜单(codemoss 双作用域语义,开关只做最常用的一键路径)。
   */
  const togglePin = (cliSessionId: string) => {
    const key = sessionPinKey(workspace.id, profile.id, cliSessionId);
    if (isSessionPinned(key)) {
      unpinSession(key);
    } else {
      pinSession(key, "global", realTitle(cliSessionId));
    }
  };
  /** 菜单目标的磁盘身份:未绑定(活会话未落盘)则不可重命名/置顶。 */
  const menuCliSessionId = menu
    ? menu.kind === "disk"
      ? menu.session.id
      : host.getCliSessionId(menu.session.id)
    : undefined;
  const menuPinKey = menuCliSessionId
    ? sessionPinKey(workspace.id, profile.id, menuCliSessionId)
    : undefined;

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
        renaming={renaming?.cliSessionId === s.id ? renaming : null}
        onOpen={() =>
          void host
            .openDiskSession(profile.id, workspace.root, workspace.id, s.id)
            .then((meta) =>
              noteSessionTabTitle(meta.id, displayTitle(s.id, s.id)),
            )
        }
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ kind: "disk", session: s, x: e.clientX, y: e.clientY });
        }}
        onRenameCommit={commitRename}
        onTogglePin={() => togglePin(s.id)}
      />
    ));

  // 整组为空则不占位(默认视图:无活会话且磁盘历史加载完也为空;归档视图:无归档项);
  // 历史加载中(orderedLive 空且 sessions===null)同样不占位
  if (isEmpty) return null;
  if (orderedLive.length === 0 && sessions === null) return null;

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
              />
            );
          })}

          {/* 磁盘历史(分页;已排除工作区置顶块与全局置顶) */}
          {renderDiskRows(visible, false)}

          {/* 分页:更多... → 翻倍(0 配额组首击从 PAGE_INITIAL 起步) */}
          {remaining > 0 && (
            <button
              className="thread-more"
              onClick={() => setLimit((l) => (l > 0 ? l * 2 : PAGE_INITIAL))}
            >
              {t("更多... (还有 {n} 条)", { n: remaining })}
            </button>
          )}
        </>
      )}

      {/* 行右键菜单 */}
      {menu && (
        <SessionContextMenu
          position={{ x: menu.x, y: menu.y }}
          canRename={menuCliSessionId !== undefined}
          pinScope={
            menuPinKey === undefined ? undefined : (pins[menuPinKey]?.scope ?? null)
          }
          onCopyId={() => copyText(menuCliSessionId ?? menu.session.id)}
          onRename={() => {
            if (!menuCliSessionId) return;
            startRename(
              menuCliSessionId,
              titleOverrides[sessionTitleKey(profile.id, menuCliSessionId)] ?? "",
            );
          }}
          onPinScope={(scope) => {
            if (!menuPinKey || !menuCliSessionId) return;
            toggleSessionPin(menuPinKey, scope, realTitle(menuCliSessionId));
          }}
          onDelete={() => {
            if (menu.kind === "live") {
              void deleteLive(menu.session);
            } else {
              void deleteDisk(menu.session);
            }
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
