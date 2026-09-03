/**
 * 近期会话 —— 所有工作区 × 已安装 CLI 的磁盘会话,按工作区分组、时间倒序。
 *
 * 数据源:各 CLI profile 的 listSessions(cwd)(真相在 CLI 磁盘目录,同左侧栏)。
 * 点击 → host.openDiskSession 直接续上(profile.resumeArgs)。
 * 每工作区最多展示 SESSIONS_PER_WORKSPACE 条;扫描失败的工作区静默跳过。
 */

import { useEffect, useState } from "react";
import { host, useHost } from "@kernel/host";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import { noteSessionTabTitle } from "@kernel/sessionTabs";
import { useWorkspaces, type Workspace } from "@kernel/workspace";
import { formatRelativeTime } from "@kernel/relativeTime";

const SESSIONS_PER_WORKSPACE = 5;

interface WorkspaceSessions {
  workspace: Workspace;
  /** (profile, session) 对,已按 modifiedAt 倒序裁剪。 */
  items: { profile: CliProfile; session: CliDiskSession }[];
}

async function scanWorkspace(
  workspace: Workspace,
  profiles: readonly CliProfile[],
): Promise<WorkspaceSessions> {
  const items: { profile: CliProfile; session: CliDiskSession }[] = [];
  await Promise.all(
    profiles.map(async (profile) => {
      if (!profile.listSessions) return;
      const sessions = await profile.listSessions(workspace.root).catch(() => []);
      for (const session of sessions) items.push({ profile, session });
    }),
  );
  items.sort((a, b) => b.session.modifiedAt - a.session.modifiedAt);
  return { workspace, items: items.slice(0, SESSIONS_PER_WORKSPACE) };
}

export function RecentSessions() {
  useHost(); /* profile 注册完成后重扫 */
  const { list: workspaces } = useWorkspaces();
  const [groups, setGroups] = useState<WorkspaceSessions[] | null>(null);

  useEffect(() => {
    if (workspaces.length === 0) return;
    let alive = true;
    const profiles = host.getCliProfiles();
    void Promise.all(
      workspaces.map((w) => scanWorkspace(w, profiles)),
    ).then((scanned) => {
      if (alive) setGroups(scanned.filter((g) => g.items.length > 0));
    });
    return () => {
      alive = false;
    };
  }, [workspaces]);

  if (!groups || groups.length === 0) return null;

  return (
    <section className="welcome-sessions">
      <h2 className="welcome-section-title">近期会话</h2>
      {groups.map((group) => (
        <div key={group.workspace.id} className="welcome-session-group">
          <div className="welcome-session-ws" title={group.workspace.root}>
            {group.workspace.name}
          </div>
          {group.items.map(({ profile, session }) => (
            <button
              key={`${profile.id}:${session.id}`}
              type="button"
              className="welcome-session-row"
              onClick={() => {
                const title = session.title ?? session.id.slice(0, 8);
                void host
                  .openDiskSession(
                    profile.id,
                    group.workspace.root,
                    group.workspace.id,
                    session.id,
                  )
                  .then((meta) => noteSessionTabTitle(meta.id, title));
              }}
            >
              <span className="welcome-session-icon" aria-hidden>
                {profile.renderIcon?.(14)}
              </span>
              <span className="welcome-session-title">
                {session.title ?? session.id.slice(0, 8)}
              </span>
              <span className="welcome-session-time">
                {formatRelativeTime(session.modifiedAt)}
              </span>
            </button>
          ))}
        </div>
      ))}
    </section>
  );
}
