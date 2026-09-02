/**
 * 会话列表 —— 活会话行 + CLI 分组 + 磁盘历史分页。
 * 数据源:活会话 = 内核 PTY 注册表;历史 = 各 CLI 插件 listSessions。
 *
 * 呼吸灯三态(内核 host 活动守望结算,见 kernel/host.ts):
 * - 绿呼吸:对话进行中(2s 内有 PTY 输出)
 * - 蓝呼吸:对话结束且未被查看(完成未读),组内置顶;点开查看即消
 * - 灰静止:已读完成 / 无输出
 * 行右键菜单:复制 Session ID / 重命名(应用侧覆盖层,见 kernel/sessionTitles.ts)
 * / 删除会话(两步确认,双端统一物理删除磁盘 jsonl)。
 */

import { useEffect, useRef, useState } from "react";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import { host, useHost } from "@kernel/host";
import { ipc, type SessionMeta } from "@kernel/ipc";
import { formatRelativeTime } from "@kernel/relativeTime";
import { useSettingsState } from "@kernel/settings";
import {
  removeSessionTitle,
  sessionTitleKey,
  setSessionTitle,
} from "@kernel/sessionTitles";
import type { Workspace } from "@kernel/workspace";
import { SessionContextMenu } from "./SessionContextMenu";
import { shortId } from "./utils";

/* 共享 1Hz ticker:N 个 ActivityDot 共用一个 interval(替代每点一表),0 订阅时停表。 */
const tickSubscribers = new Set<() => void>();
let tickTimer: number | null = null;

function subscribeActivityTick(cb: () => void): () => void {
  tickSubscribers.add(cb);
  tickTimer ??= window.setInterval(() => tickSubscribers.forEach((fn) => fn()), 1000);
  return () => {
    tickSubscribers.delete(cb);
    if (tickSubscribers.size === 0 && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

/** 呼吸灯三态:绿呼吸(对话中) / 蓝呼吸(完成未读) / 灰静止。 */
function ActivityDot({ sessionId }: { sessionId: string }) {
  useHost();
  const [, tick] = useState(0);
  useEffect(() => subscribeActivityTick(() => tick((n) => n + 1)), []);
  const alive = Date.now() - host.getLastActivityAt(sessionId) < 2000;
  const unread = host.isUnread(sessionId);
  const state = alive
    ? "animate-breathe"
    : unread
      ? "is-unread animate-breathe"
      : "is-idle";
  return <span className={`thread-runtime-dot ${state}`} />;
}

/** 磁盘历史分页: 初始 10 条,"更多..."翻倍递增(10 → 20 → 40 → 80)。 */
const PAGE_INITIAL = 10;

/** 右键菜单目标:活会话(PTY 态)或磁盘会话(文件态)。 */
type MenuTarget =
  | { kind: "live"; session: SessionMeta; x: number; y: number }
  | { kind: "disk"; session: CliDiskSession; x: number; y: number };

/** 行内重命名目标:以 CLI 磁盘身份为 key(与覆盖层同 key)。 */
interface RenameTarget {
  cliSessionId: string;
  current: string;
}

/**
 * 行内重命名输入(Enter/blur 提交,Escape 取消;空值 = 清除手动命名)。
 * settled 闸:提交/取消后卸载触发的二次 blur 不得重复回调。
 */
function RenameInput({
  target,
  onCommit,
}: {
  target: RenameTarget;
  /** value=null 为取消;否则为最终输入(可能为空串 = 清除命名)。 */
  onCommit: (value: string | null) => void;
}) {
  const [value, setValue] = useState(target.current);
  const settled = useRef(false);
  const finish = (result: string | null) => {
    if (settled.current) return;
    settled.current = true;
    onCommit(result);
  };
  return (
    <input
      className="thread-rename-input"
      autoFocus
      value={value}
      placeholder="会话名称(留空清除命名)"
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
        }
      }}
      onBlur={() => finish(value)}
    />
  );
}

/** 活会话行 —— 固定在 CLI 分组顶部;重命名态替换为输入行。 */
function LiveSessionRow({
  session,
  profile,
  isActive,
  title,
  renaming,
  onContextMenu,
  onRenameCommit,
}: {
  session: SessionMeta;
  profile: CliProfile;
  isActive: boolean;
  title: string;
  renaming: RenameTarget | null;
  onContextMenu: (e: React.MouseEvent) => void;
  onRenameCommit: (value: string | null) => void;
}) {
  if (renaming) {
    return (
      <div className="thread-row is-renaming">
        <span className="thread-engine-badge" title={profile.name}>
          {profile.renderIcon?.(12)}
        </span>
        <RenameInput target={renaming} onCommit={onRenameCommit} />
      </div>
    );
  }
  return (
    <button
      className={`thread-row${isActive ? " active" : ""}`}
      onClick={() => host.setActiveSession(session.id)}
      onContextMenu={onContextMenu}
    >
      <span className="thread-engine-badge" title={profile.name}>
        {profile.renderIcon?.(12)}
      </span>
      {/* 身份统一:绑定磁盘身份后与磁盘条目同形显示(标题/命名/短码) */}
      <span className="thread-name">{title}</span>
      <span className="thread-meta">
        <ActivityDot sessionId={session.id} />
      </span>
    </button>
  );
}

/**
 * 单个 CLI 的会话分组 —— 活会话置顶 + 磁盘历史分页。
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
  const [limit, setLimit] = useState(PAGE_INITIAL);
  /** 本地重扫信号:删除磁盘会话后立刻反映(不等外部刷新)。 */
  const [rescanTick, setRescanTick] = useState(0);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  /* 命名覆盖层变化(重命名提交)需重渲行标题 */
  const titleOverrides = useSettingsState().settings.sessionTitles;

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

  /** 行标题解析:手动命名 > 磁盘原生标题 > 短码。 */
  const displayTitle = (cliSessionId: string | undefined, fallbackId: string): string => {
    if (cliSessionId) {
      const override = titleOverrides[sessionTitleKey(profile.id, cliSessionId)];
      if (override) return override;
      const diskTitle = diskTitleByCliId.get(cliSessionId);
      if (diskTitle) return diskTitle;
    }
    return shortId(cliSessionId ?? fallbackId);
  };

  /** 活会话排序:完成未读置顶(最近完成最上),其余保持活动时间倒序。 */
  const orderedLive = [...liveSessions].sort((a, b) => {
    const ua = host.isUnread(a.id) ? 0 : 1;
    const ub = host.isUnread(b.id) ? 0 : 1;
    if (ua !== ub) return ua - ub;
    return host.getLastActivityAt(b.id) - host.getLastActivityAt(a.id);
  });

  const disk = (sessions ?? []).filter((s) => !liveCliIds.has(s.id));
  const visible = disk.slice(0, limit);
  const remaining = disk.length - visible.length;

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

  /** 删除活会话:物理删除已绑定磁盘文件(双端统一) + kill PTY + 清命名覆盖。 */
  const deleteLive = async (session: SessionMeta) => {
    const cliSessionId = host.getCliSessionId(session.id);
    const entry = cliSessionId
      ? (sessions ?? []).find((s) => s.id === cliSessionId)
      : undefined;
    if (entry) await ipc.fsRemoveFile(entry.path).catch(() => undefined);
    if (cliSessionId) removeSessionTitle(profile.id, cliSessionId);
    await host.removeSession(session.id);
  };

  /** 删除磁盘会话:物理删除 jsonl + 清命名覆盖 + 本地重扫。 */
  const deleteDisk = async (session: CliDiskSession) => {
    await ipc.fsRemoveFile(session.path).catch(() => undefined);
    removeSessionTitle(profile.id, session.id);
    setRescanTick((t) => t + 1);
  };

  const startRename = (cliSessionId: string, current: string) => {
    setRenaming({ cliSessionId, current });
  };

  // 整组为空(无活会话且磁盘历史加载完也为空)则不占位
  if (liveSessions.length === 0 && sessions !== null && disk.length === 0) {
    return null;
  }
  if (liveSessions.length === 0 && sessions === null) return null;

  return (
    <div className="cli-group">
      <div className="cli-group-label">{profile.name}</div>

      {/* 活会话(完成未读置顶,呼吸灯三态) */}
      {orderedLive.map((s) => {
        const cliSessionId = host.getCliSessionId(s.id);
        const title = displayTitle(cliSessionId, s.id);
        return (
          <LiveSessionRow
            key={s.id}
            session={s}
            profile={profile}
            isActive={s.id === activeSessionId}
            title={title}
            renaming={
              renaming && cliSessionId === renaming.cliSessionId ? renaming : null
            }
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ kind: "live", session: s, x: e.clientX, y: e.clientY });
            }}
            onRenameCommit={commitRename}
          />
        );
      })}

      {/* 磁盘历史(分页) */}
      {visible.map((s) => {
        const title = displayTitle(s.id, s.id);
        if (renaming?.cliSessionId === s.id) {
          return (
            <div key={s.id} className="thread-row is-renaming">
              <span className="thread-engine-badge" title={profile.name}>
                {profile.renderIcon?.(12)}
              </span>
              <RenameInput target={renaming} onCommit={commitRename} />
            </div>
          );
        }
        return (
          <button
            key={s.id}
            title={`恢复 ${profile.name} 会话 ${s.id}`}
            className="thread-row"
            onClick={() =>
              void host.openDiskSession(profile.id, workspace.root, workspace.id, s.id)
            }
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ kind: "disk", session: s, x: e.clientX, y: e.clientY });
            }}
          >
            <span className="thread-engine-badge" title={profile.name}>
              {profile.renderIcon?.(12)}
            </span>
            <span className="thread-name is-disk">{title}</span>
            <span className="thread-meta">
              <span className="thread-time">{formatRelativeTime(s.modifiedAt)}</span>
            </span>
          </button>
        );
      })}

      {/* 分页:更多... → 翻倍(10 → 20 → 40 → 80) */}
      {remaining > 0 && (
        <button className="thread-more" onClick={() => setLimit((l) => l * 2)}>
          更多... (还有 {remaining} 条)
        </button>
      )}

      {/* 行右键菜单 */}
      {menu && (
        <SessionContextMenu
          position={{ x: menu.x, y: menu.y }}
          canRename={
            menu.kind === "disk" || host.getCliSessionId(menu.session.id) !== undefined
          }
          onCopyId={() =>
            copyText(
              menu.kind === "disk"
                ? menu.session.id
                : (host.getCliSessionId(menu.session.id) ?? menu.session.id),
            )
          }
          onRename={() => {
            const cliSessionId =
              menu.kind === "disk"
                ? menu.session.id
                : host.getCliSessionId(menu.session.id);
            if (!cliSessionId) return;
            startRename(
              cliSessionId,
              titleOverrides[sessionTitleKey(profile.id, cliSessionId)] ?? "",
            );
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
