/**
 * 内置终端会话分组 —— kind === "shell" 的活会话(无磁盘历史/置顶/Ask 概念)。
 * 标题取 SessionMeta.title(shell 名,见 kernel/shellSessions.ts);右键 = 结束会话。
 * 扁平化(2026-09-08):分组段头/折叠退役,行首 TerminalWindow 图标区分会话种类。
 */

import { TerminalWindow } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { noteSessionTabTitle } from "@kernel/sessionTabs";
import type { Workspace } from "@kernel/workspace";
import type { SessionMeta } from "@kernel/ipc";
import { LiveOutputDot } from "./SessionRows";
/** 活会话呼吸灯(LiveOutputDot:输出即绿,无轮次概念)。 */

export function ShellSessionGroup({ workspace }: { workspace: Workspace }) {
  useHost();
  const sessions: SessionMeta[] = host
    .getSessions()
    .filter((s) => s.workspaceId === workspace.id && s.kind === "shell");
  if (sessions.length === 0) return null;
  const activeSessionId = host.getActiveSessionId();
  return (
    <div className="cli-group">
      {sessions.map((session) => {
        const title = session.title ?? session.id.slice(0, 8);
        return (
          <button
            key={session.id}
            data-session-id={session.id}
            className={`thread-row${session.id === activeSessionId ? " active" : ""}`}
            onClick={() => {
              noteSessionTabTitle(session.id, title);
              host.setActiveSession(session.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (window.confirm(t("结束终端会话「{title}」?", { title }))) {
                void host.removeSession(session.id);
              }
            }}
          >
            <LiveOutputDot sessionId={session.id} />
            <span className="thread-engine-badge" title={t("终端")} aria-hidden>
              <TerminalWindow size="0.75rem" />
            </span>
            <span className="thread-name">{title}</span>
          </button>
        );
      })}
    </div>
  );
}
