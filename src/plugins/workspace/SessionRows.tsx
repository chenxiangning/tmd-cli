/**
 * 会话行共享件 —— 行内重命名输入 + 磁盘会话行。
 * 从 SessionList 拆出:磁盘行同时服务于 CLI 分组内的工作区置顶块与分页列表,
 * RenameInput 同时服务于分组与全局置顶区(单文件 ≤500 行铁则)。
 */

import { useRef, useState } from "react";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import { formatRelativeTime } from "@kernel/relativeTime";
import { Pin } from "lucide-react";

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
        <span className="thread-engine-badge" title={profile.name}>
          {profile.renderIcon?.(12)}
        </span>
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
      <span className="thread-engine-badge" title={profile.name}>
        {profile.renderIcon?.(12)}
      </span>
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
