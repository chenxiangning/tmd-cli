/**
 * SSH 会话分组 —— kind === "ssh" 的活会话(无磁盘历史/置顶/Ask 概念)。
 * 标题取 SessionMeta.title(主机名);右键 = 断开会话(引擎发 pty://exit 收尾)。
 * 分类折叠:段头即开关(useGroupCollapsed,key = `ws:ssh`),折叠态显活会话数。
 */

import { HardDrive } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
import { noteSessionTabTitle } from "@kernel/sessionTabs";
import type { Workspace } from "@kernel/workspace";
import type { SessionMeta } from "@kernel/ipc";
import { GroupHeader } from "./GroupHeader";
import { useGroupCollapsed } from "./useGroupCollapsed";

/** 活会话呼吸灯(ActivityDot 语义的 SSH 版:输出即绿,无轮次概念)。 */
function SshActivityDot({ sessionId }: { sessionId: string }) {
  const last = host.getLastActivityAt(sessionId);
  const now = Date.now();
  const idle = now - last > 4000;
  return (
    <span className={`tl-node${idle ? " is-idle" : ""}`} aria-hidden />
  );
}

export function SshSessionGroup({ workspace }: { workspace: Workspace }) {
  useHost();
  const { collapsed, toggle } = useGroupCollapsed(workspace.id, "ssh");
  const sessions: SessionMeta[] = host
    .getSessions()
    .filter((s) => s.workspaceId === workspace.id && s.kind === "ssh");
  if (sessions.length === 0) return null;
  const activeSessionId = host.getActiveSessionId();
  return (
    <div className="cli-group">
      <GroupHeader
        label="SSH"
        icon={<HardDrive size={12} />}
        count={sessions.length}
        collapsed={collapsed}
        onToggle={toggle}
      />
      {!collapsed &&
        sessions.map((session) => {
          const title = session.title ?? session.id.slice(0, 8);
          return (
            <button
              key={session.id}
              className={`thread-row${session.id === activeSessionId ? " active" : ""}`}
              onClick={() => {
                noteSessionTabTitle(session.id, title);
                host.setActiveSession(session.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (window.confirm(`断开 SSH 会话「${title}」?`)) {
                  void host.removeSession(session.id);
                }
              }}
            >
              <SshActivityDot sessionId={session.id} />
              <span className="thread-name">{title}</span>
              <span className="thread-meta">
                <span className="thread-ask-badge" style={{ opacity: 0.7 }}>
                  SSH
                </span>
              </span>
            </button>
          );
        })}
    </div>
  );
}
