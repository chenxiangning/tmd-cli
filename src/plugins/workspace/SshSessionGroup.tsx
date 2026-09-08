/**
 * SSH 会话分组 —— kind === "ssh" 的活会话(无磁盘历史/置顶/Ask 概念)。
 * 标题取 SessionMeta.title(主机名);右键 = 断开会话(引擎发 pty://exit 收尾)。
 * 扁平化(2026-09-08):分组段头/折叠退役,行首 HardDrive 图标区分会话种类。
 */

import { HardDrive } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { noteSessionTabTitle } from "@kernel/sessionTabs";
import type { Workspace } from "@kernel/workspace";
import type { SessionMeta } from "@kernel/ipc";
import { LiveOutputDot } from "./SessionRows";
/** 活会话呼吸灯(LiveOutputDot:输出即绿,无轮次概念)。 */

export function SshSessionGroup({ workspace }: { workspace: Workspace }) {
  useHost();
  const sessions: SessionMeta[] = host
    .getSessions()
    .filter((s) => s.workspaceId === workspace.id && s.kind === "ssh");
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
              if (window.confirm(t("断开 SSH 会话「{title}」?", { title }))) {
                void host.removeSession(session.id);
              }
            }}
          >
            <LiveOutputDot sessionId={session.id} />
            <span className="thread-engine-badge" title="SSH" aria-hidden>
              <HardDrive size="0.75rem" />
            </span>
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
