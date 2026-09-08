/**
 * 会话行共享件 —— 磁盘会话行 + 活会话状态件。
 * 从 SessionList 拆出:磁盘行同时服务于 CLI 分组内的工作区置顶块与分页列表;
 * 状态件(节点/label)同时服务于分组活会话行与全局置顶区的活会话绑定行
 * (单文件 ≤300 行铁则)。行内重命名输入已沉淀进 kernel(见 @kernel/RenameInput)。
 */

import { useEffect, useState } from "react";
import { RenameInput, type RenameTarget } from "@kernel/RenameInput";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import { t } from "@kernel/i18n";
import { formatRelativeTime } from "@kernel/relativeTime";
import { host, useHost } from "@kernel/host";
import { PinIcon } from "@kernel/PinIcon";
import { resolveSessionStatus, type SessionStatus } from "./utils";

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

/** 终端/SSH 活会话呼吸灯:输出即绿,无轮次/未读概念 —— 与 CLI 会话的
 *  ActivityDot(status 状态机驱动)语义不同,4s 静默窗转灰。 */
export function LiveOutputDot({ sessionId }: { sessionId: string }) {
  const idle = Date.now() - host.getLastActivityAt(sessionId) > 4000;
  return <span className={`tl-node${idle ? " is-idle" : ""}`} aria-hidden />;
}

/** 三态 label 文案与配色类(纯文字不闪烁 —— 呼吸只属于左侧圆点,文字态以颜色区分)。 */
const STATUS_LABEL: Record<
  Exclude<SessionStatus, "none">,
  { className: string; text: string }
> = {
  running: { className: "is-run", text: "运行时" },
  unread: { className: "is-unread", text: "会话结束-未查看" },
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
  return <span className={`thread-status-label ${className}`}>{t(text)}</span>;
}

/**
 * 磁盘会话行 —— 重命名态替换为输入行;行内扎点开关 hover 显形、已扎常亮。
 * 工作区置顶块与分页历史共用同一行形,保证视觉一致。
 * archived:归档视图行 —— 时间轴圆点让位「归」字徽记(默认视图不渲染归档行)。
 */
export function DiskSessionRow({
  profile,
  session,
  title,
  pinned,
  archived,
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
  /** 归档视图标记:时间轴节点位显示「归」字。 */
  archived?: boolean;
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
      data-cli-session-id={session.id}
      className={`thread-row${pinned ? " is-pinned" : ""}`}
      title={t("恢复 {profile} 会话 {id}", { profile: profile.name, id: session.id })}
      onClick={onOpen}
      onContextMenu={onContextMenu}
    >
      {archived ? (
        <span className="tl-node tl-node-gui" aria-hidden>
          {t("归")}
        </span>
      ) : (
        <span className="tl-node is-idle" aria-hidden />
      )}
      <span className="thread-engine-badge" title={profile.name} aria-hidden>
        {profile.renderIcon?.("0.75rem")}
      </span>
      <span className="thread-name">{title}</span>
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
      aria-label={on ? t("取消置顶") : t("置顶到全局")}
      title={
        disabled
          ? t("会话尚未落盘,暂不可置顶")
          : on
            ? t("取消置顶")
            : t("置顶到全局(右键可置顶到工作区内)")
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
      <PinIcon size="0.75rem" className="thread-pin-icon" />
    </span>
  );
}
