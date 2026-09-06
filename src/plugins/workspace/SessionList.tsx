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
 * 分类折叠:段头即开关(GroupHeader),折叠态经 useGroupCollapsed 写
 * settings.workspaceGroupCollapsedMap 持久化,重启恢复;折叠计数 = 展开后可见总数。
 */

import { useState } from "react";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import { host } from "@kernel/host";
import type { SessionMeta } from "@kernel/ipc";
import {
  isSessionPinned,
  pinSession,
  sessionPinKey,
  toggleSessionPin,
  unpinSession,
} from "@kernel/sessionPins";
import { noteSessionTabTitle } from "@kernel/sessionTabs";
import {
  removeSessionTitle,
  sessionTitleKey,
  setSessionTitle,
} from "@kernel/sessionTitles";
import type { Workspace } from "@kernel/workspace";
import { SessionContextMenu } from "./SessionContextMenu";
import type { RenameTarget } from "@kernel/RenameInput";
import { DiskSessionRow } from "./SessionRows";
import {
  LiveSessionRow,
  removeDiskSession,
  type MenuTarget,
} from "./LiveSessionRow";
import { useCliSessionGroup } from "./useCliSessionGroup";
import { GroupHeader } from "./GroupHeader";
import { useGroupCollapsed } from "./useGroupCollapsed";

/** 0 配额组「更多...」首击的展开步长(正配额组从配额值起翻倍:quota → 2× → 4×)。 */
const PAGE_INITIAL = 10;

/**
 * 单个 CLI 的会话分组 —— 工作区置顶块 + 活会话 + 磁盘历史分页。
 * 活会话 spawn/exit 改变 liveCount、外部 refreshTick 变化,均触发重扫。
 */
export function CliSessionGroup({
  profile,
  workspace,
  refreshTick,
  onScanned,
}: {
  profile: CliProfile;
  workspace: Workspace;
  /** 外部刷新信号(工作区行刷新/菜单单项刷新):值变化即重扫。 */
  refreshTick: number;
  /** 扫描完成回调(驱动菜单刷新按钮的 spin 停止)。 */
  onScanned: () => void;
}) {
  const {
    sessions,
    setLimit,
    setRescanTick,
    titleOverrides,
    pins,
    activeSessionId,
    orderedLive,
    disk,
    pinnedDisk,
    visible,
    remaining,
    unpinnedCount,
    realTitle,
    displayTitle,
  } = useCliSessionGroup({ profile, workspace, refreshTick, onScanned });
  const { collapsed, toggle } = useGroupCollapsed(workspace.id, profile.id);
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

  /** 删除活会话:物理删除已绑定磁盘会话(双端统一) + kill PTY + 清命名/置顶覆盖。
   *  单库 CLI(opencode)声明 deleteSession 钩子走代写原语,其余照旧删文件。 */
  const deleteLive = async (session: SessionMeta) => {
    const cliSessionId = host.getCliSessionId(session.id);
    const entry = cliSessionId
      ? (sessions ?? []).find((s) => s.id === cliSessionId)
      : undefined;
    if (entry) await removeDiskSession(profile, entry);
    if (cliSessionId) {
      removeSessionTitle(profile.id, cliSessionId);
      unpinSession(sessionPinKey(workspace.id, profile.id, cliSessionId));
    }
    await host.removeSession(session.id);
  };

  /** 删除磁盘会话:物理删除会话(kimi 是目录,opencode 是库内行)+ 清命名/置顶覆盖 + 本地重扫。 */
  const deleteDisk = async (session: CliDiskSession) => {
    await removeDiskSession(profile, session);
    removeSessionTitle(profile.id, session.id);
    unpinSession(sessionPinKey(workspace.id, profile.id, session.id));
    setRescanTick((t) => t + 1);
  };

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

  // 整组为空(无活会话且磁盘历史加载完也为空)则不占位
  if (orderedLive.length === 0 && sessions !== null && disk.length === 0) {
    return null;
  }
  if (orderedLive.length === 0 && sessions === null) return null;

  return (
    <div className="cli-group">
      {/* 分类段头 = 折叠开关;计数仅折叠态显示(展开后可见总数:活 + 工作区置顶 + 未置顶磁盘) */}
      <GroupHeader
        label={profile.name}
        icon={profile.renderIcon ? profile.renderIcon(12) : undefined}
        count={orderedLive.length + pinnedDisk.length + unpinnedCount}
        collapsed={collapsed}
        onToggle={toggle}
      />

      {/* 折叠:仅段头 + 计数;展开:置顶块 + 活会话 + 磁盘历史 + 分页 */}
      {!collapsed && (
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
              更多... (还有 {remaining} 条)
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
