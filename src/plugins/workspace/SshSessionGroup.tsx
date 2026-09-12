/**
 * SSH 会话分组 —— 纯 SSH 终端会话(kind === "ssh" 且无 engine)。
 * 带 engine 的远程引擎会话(WSL CLI 恢复)归入引擎的 CLI 组(useCliSessionGroup),
 * 不在本组重复出现。标题取 SessionMeta.title(主机名);右键 = 断开会话。
 * 扁平化(2026-09-08):分组段头/折叠退役,行首引擎图标区分会话种类。
 */

import { HardDrive } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { getSessionBaseline, getSessionTabTitle, noteSessionTabTitle } from "@kernel/sessionTabs";
import type { Workspace } from "@kernel/workspace";
import type { SessionMeta } from "@kernel/ipc";
import { LiveOutputDot } from "./SessionRows";
/** 活会话呼吸灯(LiveOutputDot:输出即绿,无轮次概念)。 */

export function SshSessionGroup({ workspace }: { workspace: Workspace }) {
  useHost();
  const sessions: SessionMeta[] = host
    .getSessions()
    .filter((s) => s.workspaceId === workspace.id && s.kind === "ssh" && !s.engine);
  if (sessions.length === 0) return null;
  const activeSessionId = host.getActiveSessionId();
  return (
    <div className="cli-group">
      {sessions.map((session) => {
        /* 标题链与 CLI 行同构:tab 快照/首条消息保底(远程会话无本机磁盘命名,
           promptSent 保底即主命名源)→ 主机名兜底。引擎会话行首挂引擎徽标。 */
        const title =
          getSessionTabTitle(session.id) ??
          getSessionBaseline(session.id) ??
          session.title ??
          session.id.slice(0, 8);
        const engineProfile = session.engine ? host.getCliProfile(session.engine) : undefined;
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
            <span
              className="thread-engine-badge"
              title={engineProfile?.name ?? "SSH"}
              aria-hidden
            >
              {engineProfile ? engineProfile.renderIcon?.(14) ?? <HardDrive size="0.75rem" /> : <HardDrive size="0.75rem" />}
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
