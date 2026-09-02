/**
 * 会话列表 —— 活会话行 + CLI 分组 + 磁盘历史分页。
 * 数据源:活会话 = 内核 PTY 注册表;历史 = 各 CLI 插件 listSessions。
 */

import { useEffect, useState } from "react";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import { host, useHost } from "@kernel/host";
import type { SessionMeta } from "@kernel/ipc";
import { formatRelativeTime } from "@kernel/relativeTime";
import type { Workspace } from "@kernel/workspace";
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

/** 呼吸灯：2 秒内有过 PTY 输出 = 呼吸态，否则静止。 */
function ActivityDot({ sessionId }: { sessionId: string }) {
  useHost();
  const [, tick] = useState(0);
  useEffect(() => subscribeActivityTick(() => tick((n) => n + 1)), []);
  const alive = Date.now() - host.getLastActivityAt(sessionId) < 2000;
  return (
    <span
      className={`thread-runtime-dot ${alive ? "animate-breathe" : "is-idle"}`}
    />
  );
}

/** 磁盘历史分页: 初始 10 条,"更多..."翻倍递增(10 → 20 → 40 → 80)。 */
const PAGE_INITIAL = 10;

/** 活会话行 —— 固定在 CLI 分组顶部,meta 区呼吸灯(codemoss runtime dot)。 */
function LiveSessionRow({
  session,
  profile,
  isActive,
}: {
  session: SessionMeta;
  profile: CliProfile;
  isActive: boolean;
}) {
  return (
    <button
      className={`thread-row${isActive ? " active" : ""}`}
      onClick={() => host.setActiveSession(session.id)}
    >
      <span className="thread-engine-badge" title={profile.name}>
        {profile.renderIcon?.(12)}
      </span>
      {/* 身份统一:绑定磁盘身份后与磁盘条目同形显示;未绑定退回 PTY 短码 */}
      <span className="thread-name">
        {shortId(host.getCliSessionId(session.id) ?? session.id)}
      </span>
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
  }, [profile, workspace.root, liveSessions.length, refreshTick]);

  const disk = (sessions ?? []).filter((s) => !liveCliIds.has(s.id));
  const visible = disk.slice(0, limit);
  const remaining = disk.length - visible.length;

  // 整组为空(无活会话且磁盘历史加载完也为空)则不占位
  if (liveSessions.length === 0 && sessions !== null && disk.length === 0) {
    return null;
  }
  if (liveSessions.length === 0 && sessions === null) return null;

  return (
    <div className="cli-group">
      <div className="cli-group-label">{profile.name}</div>

      {/* 活会话置顶(呼吸灯) */}
      {liveSessions.map((s) => (
        <LiveSessionRow
          key={s.id}
          session={s}
          profile={profile}
          isActive={s.id === activeSessionId}
        />
      ))}

      {/* 磁盘历史(分页) */}
      {visible.map((s) => (
        <button
          key={s.id}
          title={`恢复 ${profile.name} 会话 ${s.id}`}
          className="thread-row"
          onClick={() =>
            void host.openDiskSession(profile.id, workspace.root, workspace.id, s.id)
          }
        >
          <span className="thread-engine-badge" title={profile.name}>
            {profile.renderIcon?.(12)}
          </span>
          <span className="thread-name is-disk">
            {s.title ?? shortId(s.id)}
          </span>
          <span className="thread-meta">
            <span className="thread-time">{formatRelativeTime(s.modifiedAt)}</span>
          </span>
        </button>
      ))}

      {/* 分页:更多... → 翻倍(10 → 20 → 40 → 80) */}
      {remaining > 0 && (
        <button className="thread-more" onClick={() => setLimit((l) => l * 2)}>
          更多... (还有 {remaining} 条)
        </button>
      )}
    </div>
  );
}
