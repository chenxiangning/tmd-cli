/**
 * 会话行共享件 —— 磁盘会话行 + 活会话状态件。
 * 从 SessionList 拆出:磁盘行同时服务于 CLI 分组内的工作区置顶块与分页列表;
 * 状态件(节点/label)同时服务于分组活会话行与全局置顶区的活会话绑定行
 * (单文件 ≤300 行铁则)。行内重命名输入已沉淀进 kernel(见 @kernel/RenameInput)。
 */

import { useEffect, useRef, useState } from "react";
import { RenameInput, type RenameTarget } from "@kernel/RenameInput";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import { t } from "@kernel/i18n";
import { formatRelativeTime } from "@kernel/relativeTime";
import { host } from "@kernel/host";
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

/** 1Hz 兜底重渲(仅状态真变时)+ 宿主守望口径 → 当前状态(状态机见
 *  utils.resolveSessionStatus)。状态值渲染期现算:notify 驱动父行重渲染即
 *  即时生效(父级已订阅 host,本处不再重复订阅);ticker 只在无 notify 的
 *  静默期兜底,且状态不变不重渲 —— 恒定负载不再随状态行数放大。 */
function useSessionStatus(sessionId: string): SessionStatus {
  const [, tick] = useState(0);
  const status = resolveSessionStatus(
    host.getLastActivityAt(sessionId),
    host.isUnread(sessionId),
    Date.now(),
    host.isTurnActive(sessionId),
  );
  /* 最近一帧状态的镜像:effect 写入(渲染期写 ref 违反并发语义),ticker 比对用 */
  const lastRef = useRef(status);
  useEffect(() => {
    lastRef.current = status;
  });
  useEffect(
    () =>
      subscribeActivityTick(() => {
        const next = resolveSessionStatus(
          host.getLastActivityAt(sessionId),
          host.isUnread(sessionId),
          Date.now(),
          host.isTurnActive(sessionId),
        );
        if (next !== lastRef.current) tick((n) => n + 1);
      }),
    [sessionId],
  );
  return status;
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
 *  ActivityDot(status 状态机驱动)语义不同,4s 静默窗闲置隐藏(1Hz ticker
 *  驱动隐判定,不依赖无关 host 事件触发重渲);闲置翻转才重渲,恒定零负载。 */
export function LiveOutputDot({ sessionId }: { sessionId: string }) {
  const [, tick] = useState(0);
  const idle = Date.now() - host.getLastActivityAt(sessionId) > 4000;
  /* 闲置标记镜像:effect 写入(渲染期写 ref 违反并发语义),ticker 比对用 */
  const idleRef = useRef(idle);
  useEffect(() => {
    idleRef.current = idle;
  });
  useEffect(
    () =>
      subscribeActivityTick(() => {
        const next = Date.now() - host.getLastActivityAt(sessionId) > 4000;
        if (next !== idleRef.current) tick((n) => n + 1);
      }),
    [sessionId],
  );
  return <span className={`tl-node${idle ? " is-idle" : ""}`} aria-hidden />;
}

/** 三态 label 文案与配色类(纯文字不闪烁 —— 呼吸只属于左侧圆点,文字态以颜色区分)。 */
const STATUS_LABEL: Record<
  Exclude<SessionStatus, "none">,
  { className: string; text: string }
> = {
  running: { className: "is-run", text: "运行时" },
  unread: { className: "is-unread", text: "空闲-未查看" },
  viewed: { className: "is-viewed", text: "空闲" },
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
    <span className="thread-row-host">
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
          <span className="thread-time">{formatRelativeTime(session.modifiedAt)}</span>
        </span>
      </button>
      {/* 置顶钮与行按钮 DOM 分离(嵌套交互治理):hover 显形改吃宿主 hover。 */}
      <PinToggle on={pinned} onToggle={onTogglePin} />
    </span>
  );
}

/**
 * 行内扎点开关 —— hover 显形 / 已扎常亮;真 button 承载(与行按钮为兄弟,
 * 不再嵌套在行激活热区内;hover/焦点显形经 .thread-row-host 前缀选择器)。
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
    <button
      type="button"
      className={`thread-pin-btn${on ? " is-on" : ""}`}
      aria-pressed={on}
      aria-label={on ? t("取消置顶") : t("置顶到全局")}
      title={
        disabled
          ? t("会话尚未落盘,暂不可置顶")
          : on
            ? t("取消置顶")
            : t("置顶到全局(右键可置顶到工作区内)")
      }
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <PinIcon size="0.75rem" className="thread-pin-icon" />
    </button>
  );
}

