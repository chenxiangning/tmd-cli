/**
 * 会话行共享件 —— 行内重命名输入 + 磁盘会话行 + 活会话状态件。
 * 从 SessionList 拆出:磁盘行同时服务于 CLI 分组内的工作区置顶块与分页列表,
 * RenameInput 同时服务于分组与全局置顶区;状态件(节点/label)同时服务于
 * 分组活会话行与全局置顶区的活会话绑定行(单文件 ≤500 行铁则)。
 */

import { useEffect, useRef, useState } from "react";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import { formatRelativeTime } from "@kernel/relativeTime";
import { host, useHost } from "@kernel/host";
import { Eye, Pin } from "lucide-react";
import { resolveSessionStatus, type SessionStatus } from "./utils";

/** 行内重命名目标:以 CLI 磁盘身份为 key(与覆盖层同 key)。 */
export interface RenameTarget {
  profileId: string;
  cliSessionId: string;
  current: string;
}

/**
 * 行内重命名输入(Enter/blur 提交,Escape 取消;空值 = 清除手动命名)。
 * settled 闸:提交/取消后卸载触发的二次 blur 不得重复回调。
 */
export function RenameInput({
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

/* 共享 1Hz ticker:N 个状态件共用一个 interval(替代每件一表),0 订阅时停表。 */
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

export type { SessionStatus };

/** 1Hz 重渲 + host 守望口径 → 当前状态(状态机见 utils.resolveSessionStatus)。 */
export function useSessionStatus(sessionId: string): SessionStatus {
  useHost();
  const [, tick] = useState(0);
  useEffect(() => subscribeActivityTick(() => tick((n) => n + 1)), []);
  return resolveSessionStatus(
    host.getLastActivityAt(sessionId),
    host.isUnread(sessionId),
    Date.now(),
  );
}

/** 时间节点三态:绿呼吸(对话中) / 蓝呼吸(完成未读) / 灰静止 —— 呼吸灯从 meta 区移到时间轴节点位。 */
export function ActivityDot({ sessionId }: { sessionId: string }) {
  const status = useSessionStatus(sessionId);
  const state =
    status === "running"
      ? "is-run animate-breathe"
      : status === "unread"
        ? "is-unread animate-breathe"
        : "is-idle";
  return <span className={`tl-node ${state}`} aria-hidden />;
}

/**
 * 左侧节点槽位:正在查看(viewing = active)时圆点让位给 Eye 图标,
 * 切走/关闭会话即还原圆点 —— 「查看中」语义压过状态灯。
 */
export function SessionNode({
  sessionId,
  viewing,
}: {
  sessionId: string;
  viewing: boolean;
}) {
  if (viewing) {
    return (
      <span className="tl-node tl-node-viewing" aria-hidden>
        <Eye size={13} className="thread-viewing-eye" />
      </span>
    );
  }
  return <ActivityDot sessionId={sessionId} />;
}

/** 三态 label 文案与配色类(呼吸沿用圆点的 animate-breathe)。 */
const STATUS_LABEL: Record<
  Exclude<SessionStatus, "none">,
  { className: string; text: string }
> = {
  running: { className: "is-run animate-breathe", text: "运行时" },
  unread: { className: "is-unread animate-breathe", text: "会话结束-未查看" },
  viewed: { className: "is-viewed", text: "会话结束-已查看" },
};

/**
 * 会话状态校准 label —— 把呼吸灯暗示改为文字明示,meta 区实时刷新。
 * 仅活会话:磁盘历史行无未读/进行中概念,不出签。
 */
export function SessionStatusLabel({ sessionId }: { sessionId: string }) {
  const status = useSessionStatus(sessionId);
  if (status === "none") return null;
  const { className, text } = STATUS_LABEL[status];
  return <span className={`thread-status-label ${className}`}>{text}</span>;
}

/**
 * 磁盘会话行 —— 重命名态替换为输入行;行内扎点开关 hover 显形、已扎常亮。
 * 工作区置顶块与分页历史共用同一行形,保证视觉一致。
 */
export function DiskSessionRow({
  profile,
  session,
  title,
  pinned,
  renaming,
  onOpen,
  onContextMenu,
  onRenameCommit,
  onTogglePin,
}: {
  profile: CliProfile;
  session: CliDiskSession;
  title: string;
  /** 工作区内置顶:行内扎点常亮,行加重量提示。 */
  pinned: boolean;
  renaming: RenameTarget | null;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRenameCommit: (value: string | null) => void;
  /** 点击扎点开关:未扎 → 置顶到全局;已扎 → 取消置顶(磁盘会话必已落盘)。 */
  onTogglePin: () => void;
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
      title={`恢复 ${profile.name} 会话 ${session.id}`}
      className={`thread-row${pinned ? " is-pinned" : ""}`}
      onClick={onOpen}
      onContextMenu={onContextMenu}
    >
      <span className="tl-node is-idle" aria-hidden />
      <span className="thread-name is-disk">{title}</span>
      <span className="thread-meta">
        <PinToggle on={pinned} onToggle={onTogglePin} />
        <span className="thread-time">{formatRelativeTime(session.modifiedAt)}</span>
      </span>
    </button>
  );
}

/**
 * 行内扎点开关 —— hover 显形 / 已扎常亮;span 承载(行本身是 button,禁嵌套 button)。
 * 点击切换:未扎 → 置顶到全局;已扎(任一作用域)→ 取消置顶。置顶到工作区内仍走右键菜单。
 */
export function PinToggle({
  on,
  disabled,
  onToggle,
}: {
  on: boolean;
  /** 会话尚未落盘时不可扎(覆盖层以 CLI 身份为 key)。 */
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <span
      className={`thread-pin-btn${on ? " is-on" : ""}`}
      role="button"
      aria-pressed={on}
      aria-label={on ? "取消置顶" : "置顶到全局"}
      title={
        disabled
          ? "会话尚未落盘,暂不可置顶"
          : on
            ? "取消置顶"
            : "置顶到全局(右键可置顶到工作区内)"
      }
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onToggle();
      }}
      onKeyDown={(e) => {
        /* 行是 button:Enter/Space 已冒泡触发开行,这里拦下避免双重激活。 */
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
          e.preventDefault();
          if (!disabled) onToggle();
        }
      }}
    >
      <Pin size={12} className="thread-pin-icon" aria-hidden />
    </span>
  );
}
