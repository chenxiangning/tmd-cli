/**
 * 当前激活会话对应 CLI profile —— composer 需要将触发符行为交回给 profile owner。
 * 没有活跃会话/找不到 profile 时返回 null。
 */

import { useEffect, useState } from "react";
import { host, useHost } from "@kernel/host";
import type { CliProfile } from "@kernel/cli";

export function useActiveProfile(): CliProfile | null {
  useHost();
  const [profile, setProfile] = useState<CliProfile | null>(() => currentProfile());
  useEffect(() => {
    setProfile(currentProfile());
  }, [host.getActiveSessionId(), host.getVersion()]);
  return profile;
}

function currentProfile(): CliProfile | null {
  const sid = host.getActiveSessionId();
  if (!sid) return null;
  const session = host.getSessions().find((s) => s.id === sid);
  if (!session) return null;
  return host.getCliProfile(session.profileId) ?? null;
}
