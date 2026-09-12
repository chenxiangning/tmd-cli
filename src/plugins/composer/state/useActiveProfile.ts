/**
 * 当前激活会话对应 CLI profile —— composer 需要将触发符行为交回给 profile owner。
 * 没有活跃会话/找不到 profile 时返回 null。
 */

import { useEffect, useState } from "react";
import { host, useHost } from "@kernel/host";
import type { CliProfile } from "@kernel/cli";
import type { SessionMeta } from "@kernel/ipc";

export function useActiveProfile(): CliProfile | null {
  useHost();
  const [profile, setProfile] = useState<CliProfile | null>(() => currentProfile());
  const sessionId = host.getActiveSessionId();
  const hostVersion = host.getVersion();
  useEffect(() => {
    setProfile(currentProfile());
  }, [sessionId, hostVersion]);
  return profile;
}

/** 当前激活 session(工具条按会话形态分流:远程引擎会话不读本机配置种子)。 */
export function useActiveSession(): SessionMeta | null {
  useHost();
  const [session, setSession] = useState<SessionMeta | null>(() => currentSession());
  const sessionId = host.getActiveSessionId();
  const hostVersion = host.getVersion();
  useEffect(() => {
    setSession(currentSession());
  }, [sessionId, hostVersion]);
  return session;
}

function currentSession(): SessionMeta | null {
  const sid = host.getActiveSessionId();
  if (!sid) return null;
  return host.getSessions().find((s) => s.id === sid) ?? null;
}

/** 远程引擎会话(SSH 会话带 engine,如 WSL CLI):模型/思考/额度的本机数据源不可信。 */
export function isRemoteEngineSession(session: SessionMeta | null): boolean {
  return !!session && session.kind === "ssh" && !!session.engine;
}

function currentProfile(): CliProfile | null {
  const sid = host.getActiveSessionId();
  if (!sid) return null;
  const session = host.getSessions().find((s) => s.id === sid);
  if (!session) return null;
  /* SSH 会话带 engine(远程 WSL CLI)= 按 engine 取 profile;本地会话 profileId 即引擎。 */
  return host.getCliProfile(session.engine ?? session.profileId) ?? null;
}
