/**
 * 内置终端会话分组 —— kind === "shell" 的活会话(无磁盘历史/置顶/Ask 概念)。
 * 标题取 SessionMeta.title(shell 名,见 kernel/shellSessions.ts);右键 = 结束会话。
 * SSH 分组(SshSessionGroup)的同构镜像:kind 是内核级会话概念,分组归侧栏所有。
 */

import { SquareTerminal } from "lucide-react";
import { host, useHost } from "@kernel/host";
import { noteSessionTabTitle } from "@kernel/sessionTabs";
import type { Workspace } from "@kernel/workspace";
import type { SessionMeta } from "@kernel/ipc";

/** 活会话呼吸灯(ActivityDot 语义的终端版:输出即绿,无轮次概念)。 */
function ShellActivityDot({ sessionId }: { sessionId: string }) {
  const last = host.getLastActivityAt(sessionId);
  const now = Date.now();
  const idle = now - last > 4000;
  return <span className={`tl-node${idle ? " is-idle" : ""}`} aria-hidden />;
}

export function ShellSessionGroup({ workspace }: { workspace: Workspace }) {
  useHost();
  const sessions: SessionMeta[] = host
    .getSessions()
    .filter((s) => s.workspaceId === workspace.id && s.kind === "shell");
  if (sessions.length === 0) return null;
  const activeSessionId = host.getActiveSessionId();
  return (
    <div className="cli-group">
      <div className="cli-group-label">
        <span className="cli-group-label-icon" aria-hidden>
          <SquareTerminal size={12} />
        </span>
        终端
      </div>
      {sessions.map((session) => {
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
              if (window.confirm(`结束终端会话「${title}」?`)) {
                void host.removeSession(session.id);
              }
            }}
          >
            <ShellActivityDot sessionId={session.id} />
            <span className="thread-name">{title}</span>
          </button>
        );
      })}
    </div>
  );
}
