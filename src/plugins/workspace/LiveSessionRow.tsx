/**
 * 活会话行 —— 自 SessionList.tsx 拆出(文件规模铁则)。
 *
 * 固定在 CLI 分组顶部(工作区置顶块之上);重命名态替换为输入行。
 * 磁盘会话物理删除助手已拆至 sessionOps.ts(普通视图与管理模式共用)。
 */

import type { CliDiskSession } from "@kernel/cli";
import { host } from "@kernel/host";
import type { SessionMeta } from "@kernel/ipc";
import { noteSessionTabTitle } from "@kernel/sessionTabs";
import { RenameInput, type RenameTarget } from "@kernel/RenameInput";
import { PinToggle, SessionNode, SessionStatusLabel } from "./SessionRows";

/** 右键菜单目标:活会话(PTY 态)或磁盘会话(文件态)。 */
export type MenuTarget =
  | { kind: "live"; session: SessionMeta; x: number; y: number }
  | { kind: "disk"; session: CliDiskSession; x: number; y: number };


export function LiveSessionRow({
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
