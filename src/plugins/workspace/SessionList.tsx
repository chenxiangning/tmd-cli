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
 */

import { useEffect, useRef, useState } from "react";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import { host, useHost } from "@kernel/host";
import { ipc, type SessionMeta } from "@kernel/ipc";
import { resolveCliSessionQuota, useSettingsState } from "@kernel/settings";
import {
  isSessionPinned,
  listSessionPins,
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
  shortId,
} from "@kernel/sessionTitles";
import type { Workspace } from "@kernel/workspace";
import { SessionContextMenu } from "./SessionContextMenu";
import {
  DiskSessionRow,
  PinToggle,
  RenameInput,
  SessionNode,
  SessionStatusLabel,
  type RenameTarget,
} from "./SessionRows";
import { compareLiveSessions } from "./utils";

/** 0 配额组「更多...」首击的展开步长(正配额组从配额值起翻倍:quota → 2× → 4×)。 */
const PAGE_INITIAL = 10;

/** 右键菜单目标:活会话(PTY 态)或磁盘会话(文件态)。 */
type MenuTarget =
  | { kind: "live"; session: SessionMeta; x: number; y: number }
  | { kind: "disk"; session: CliDiskSession; x: number; y: number };

/** 活会话行 —— 固定在 CLI 分组顶部(工作区置顶块之上);重命名态替换为输入行。 */
function LiveSessionRow({
  session,
  isActive,
  title,
  pinned,
  canPin,
  waiting,
  renaming,
  onContextMenu,
  onTogglePin,
  onRenameCommit,
}: {
  session: SessionMeta;
  isActive: boolean;
  title: string;
  pinned: boolean;
  /** 已绑定磁盘身份才可扎(覆盖层以 CLI 身份为 key)。 */
  canPin: boolean;
  /** 正等待用户确认(Ask 标记命中):meta 区亮「等待确认」标签,作答即消。 */
  waiting: boolean;
  renaming: RenameTarget | null;
  onContextMenu: (e: React.MouseEvent) => void;
  onTogglePin: () => void;
  onRenameCommit: (value: string | null) => void;
}) {
  if (renaming) {
    return (
      <div className="thread-row is-renaming">
        <span className="tl-node is-idle" aria-hidden />
        <RenameInput target={renaming} onCommit={onRenameCommit} />
      </div>
    );
  }
  return (
    <button
      className={`thread-row${isActive ? " active" : ""}`}
      onClick={() => {
        noteSessionTabTitle(session.id, title);
        host.setActiveSession(session.id);
      }}
      onContextMenu={onContextMenu}
    >
      <SessionNode sessionId={session.id} viewing={isActive} />
      {/* 身份统一:绑定磁盘身份后与磁盘条目同形显示(标题/命名/短码) */}
      <span className="thread-name">{title}</span>
      <span className="thread-meta">
        <SessionStatusLabel sessionId={session.id} />
        {waiting ? <span className="thread-ask-badge">等待确认</span> : null}
        <PinToggle on={pinned} disabled={!canPin} onToggle={onTogglePin} />
      </span>
    </button>
  );
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
}: {
  profile: CliProfile;
  workspace: Workspace;
  /** 外部刷新信号(工作区行刷新/菜单单项刷新):值变化即重扫。 */
  refreshTick: number;
  /** 扫描完成回调(驱动菜单刷新按钮的 spin 停止)。 */
  onScanned: () => void;
}) {
  useHost();
  const [sessions, setSessions] = useState<CliDiskSession[] | null>(null);
  const { settings } = useSettingsState();
  /**
   * 初始露出条数 = 显示预算解析配额(断裂修复:曾硬编码 PAGE_INITIAL,
   * settings.sessionListBudget 从不被消费,设置改了列表没反应)。
   * 拔出门控:session-budget 插件未激活 = 完全断电,回默认分页;
   * 预算数值保留在 settings,重新插入插件后继续生效。
   */
  const initialLimit = host.isPluginActive("session-budget")
    ? resolveCliSessionQuota(
        settings.sessionListBudget,
        profile.id,
        host.getCliProfiles().map((p) => p.id),
      )
    : PAGE_INITIAL;
  const [limit, setLimit] = useState(initialLimit);
  /** 预算修改响应式生效:按新配额重新起步(已展开的「更多」随之重置)。 */
  useEffect(() => {
    setLimit(initialLimit);
  }, [initialLimit]);
  /** 本地重扫信号:删除磁盘会话后立刻反映(不等外部刷新)。 */
  const [rescanTick, setRescanTick] = useState(0);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  /* 命名覆盖层变化(重命名提交)需重渲行标题 */
  const titleOverrides = settings.sessionTitles;
  const pins = settings.sessionPins;

  const liveSessions = host
    .getSessions()
    .filter((s) => s.workspaceId === workspace.id && s.profileId === profile.id);
  const activeSessionId = host.getActiveSessionId();
  /** 活会话已绑定的磁盘身份:磁盘行据此过滤,同一会话全局只出现一次。 */
  const liveCliIds = new Set(
    liveSessions
      .map((s) => host.getCliSessionId(s.id))
      .filter((id): id is string => id !== undefined),
  );

  /* 身份绑定跳变 → 磁盘重扫:omp 实证懒落盘晚于 spawn 35s+,spawn 时点的扫描看不到
   * 文件与标题;绑定成功即文件已出生,立即补扫,并延迟再补一次(自动命名晚 birth ~1s)。 */
  const boundCount = liveCliIds.size;
  const prevBoundCount = useRef(boundCount);
  useEffect(() => {
    if (boundCount === prevBoundCount.current) return;
    prevBoundCount.current = boundCount;
    setRescanTick((t) => t + 1);
    const catchUp = setTimeout(() => setRescanTick((t) => t + 1), 3_000);
    return () => clearTimeout(catchUp);
  }, [boundCount]);

  useEffect(() => {
    let stale = false;
    if (!profile.listSessions) return;
    void profile
      .listSessions(workspace.root)
      .then((list) => {
        if (!stale) setSessions(list);
      })
      .catch(() => {
        if (!stale) setSessions([]);
      })
      .finally(() => {
        if (!stale) onScanned();
      });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onScanned 为稳定引用语义,不作为依赖
  }, [profile, workspace.root, liveSessions.length, refreshTick, rescanTick]);

  /** 磁盘扫描出的原生标题索引(含活会话已绑定条目,活行据此同形显示)。 */
  const diskTitleByCliId = new Map(
    (sessions ?? [])
      .filter((s) => s.title)
      .map((s) => [s.id, s.title as string]),
  );

  /** 真标题:手动命名 > 磁盘原生标题。短码兜底不是标题 —— 置顶快照只收这里的结果。 */
  const realTitle = (cliSessionId: string | undefined): string | undefined => {
    if (!cliSessionId) return undefined;
    return (
      titleOverrides[sessionTitleKey(profile.id, cliSessionId)] ??
      diskTitleByCliId.get(cliSessionId)
    );
  };

  /** 行标题解析:手动命名 > 磁盘原生标题 > 短码。 */
  const displayTitle = (cliSessionId: string | undefined, fallbackId: string): string =>
    realTitle(cliSessionId) ?? shortId(cliSessionId ?? fallbackId);

  /** 本组置顶投影:workspace scope → 组顶块;global scope → 离组进全局区。 */
  const workspacePins = listSessionPins(pins, {
    workspaceId: workspace.id,
    profileId: profile.id,
    scope: "workspace",
  });
  const pinnedOutIds = new Set(
    listSessionPins(pins, {
      workspaceId: workspace.id,
      profileId: profile.id,
      scope: "global",
    }).map((p) => p.cliSessionId),
  );
  const workspacePinnedIds = new Set(workspacePins.map((p) => p.cliSessionId));

  /** 活会话排序:完成未读置顶,其余 spawn 时间倒序(比较器见 utils —— 稳定键防抖动);
   *  scope=global 的活会话离组,汇入全局「已置顶」区,不在本组显示。
   *  pinnedOutIds 已按本工作区+本 CLI 过滤,存裸 cliSessionId(与磁盘过滤的 s.id 同构)。 */
  const orderedLive = [...liveSessions]
    .filter((s) => {
      const cliSessionId = host.getCliSessionId(s.id);
      return cliSessionId === undefined || !pinnedOutIds.has(cliSessionId);
    })
    .sort((a, b) => compareLiveSessions(a, b, (id) => host.isUnread(id)));

  const disk = (sessions ?? []).filter((s) => !liveCliIds.has(s.id));
  /* 工作区置顶块:按置顶时间升序;磁盘已消失的置顶(外部删文件)自然缺席。 */
  const pinnedDisk = workspacePins.flatMap((p) => {
    const entry = disk.find((d) => d.id === p.cliSessionId);
    return entry ? [entry] : [];
  });
  /* 时间轴语义:显式按修改时间倒序,不依赖各 CLI listSessions 的返回顺序。 */
  const unpinnedDisk = disk
    .filter((s) => !workspacePinnedIds.has(s.id) && !pinnedOutIds.has(s.id))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
  const visible = unpinnedDisk.slice(0, limit);
  const remaining = unpinnedDisk.length - visible.length;

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

  /** 删除活会话:物理删除已绑定磁盘文件(双端统一) + kill PTY + 清命名/置顶覆盖。 */
  const deleteLive = async (session: SessionMeta) => {
    const cliSessionId = host.getCliSessionId(session.id);
    const entry = cliSessionId
      ? (sessions ?? []).find((s) => s.id === cliSessionId)
      : undefined;
    if (entry) await ipc.fsRemovePath(entry.path).catch(() => undefined);
    if (cliSessionId) {
      removeSessionTitle(profile.id, cliSessionId);
      unpinSession(sessionPinKey(workspace.id, profile.id, cliSessionId));
    }
    await host.removeSession(session.id);
  };

  /** 删除磁盘会话:物理删除会话文件/目录(kimi 是目录) + 清命名/置顶覆盖 + 本地重扫。 */
  const deleteDisk = async (session: CliDiskSession) => {
    await ipc.fsRemovePath(session.path).catch(() => undefined);
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

  // 整组为空(无活会话且磁盘历史加载完也为空)则不占位
  if (orderedLive.length === 0 && sessions !== null && disk.length === 0) {
    return null;
  }
  if (orderedLive.length === 0 && sessions === null) return null;

  return (
    <div className="cli-group">
      <div className="cli-group-label">
        {/* 品牌 logo 段头:骑在时间轴轨道中心(取代空心环;无 renderIcon 回退环) */}
        {profile.renderIcon ? (
          <span className="cli-group-label-icon" aria-hidden>
            {profile.renderIcon(12)}
          </span>
        ) : null}
        {profile.name}
      </div>

      {/* 工作区置顶块(置顶时间升序,行内扎点常亮) */}
      {pinnedDisk.map((s) => (
        <DiskSessionRow
          key={s.id}
          profile={profile}
          session={s}
          title={displayTitle(s.id, s.id)}
          pinned
          renaming={renaming?.cliSessionId === s.id ? renaming : null}
          onOpen={() =>
            void host
              .openDiskSession(profile.id, workspace.root, workspace.id, s.id)
              .then((meta) => noteSessionTabTitle(meta.id, displayTitle(s.id, s.id)))
          }
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ kind: "disk", session: s, x: e.clientX, y: e.clientY });
          }}
          onRenameCommit={commitRename}
          onTogglePin={() => togglePin(s.id)}
        />
      ))}

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
              renaming && cliSessionId === renaming.cliSessionId ? renaming : null
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
      {visible.map((s) => (
        <DiskSessionRow
          key={s.id}
          profile={profile}
          session={s}
          title={displayTitle(s.id, s.id)}
          pinned={false}
          renaming={renaming?.cliSessionId === s.id ? renaming : null}
          onOpen={() =>
            void host
              .openDiskSession(profile.id, workspace.root, workspace.id, s.id)
              .then((meta) => noteSessionTabTitle(meta.id, displayTitle(s.id, s.id)))
          }
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ kind: "disk", session: s, x: e.clientX, y: e.clientY });
          }}
          onRenameCommit={commitRename}
          onTogglePin={() => togglePin(s.id)}
        />
      ))}

      {/* 分页:更多... → 翻倍(0 配额组首击从 PAGE_INITIAL 起步) */}
      {remaining > 0 && (
        <button
          className="thread-more"
          onClick={() => setLimit((l) => (l > 0 ? l * 2 : PAGE_INITIAL))}
        >
          更多... (还有 {remaining} 条)
        </button>
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

