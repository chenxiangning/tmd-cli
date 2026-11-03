import { retryOpenRef, type RetryOpenDetail } from "@kernel/relayBridge";
import type { CliProfile } from "@kernel/cli";
import type { SessionMeta } from "@kernel/ipc";
import type { Workspace } from "@kernel/workspace";

/** 插件启用才给入口;点击时重读桥,菜单存活期内停用也不空调用。 */
export function retryMenuHandler(detail: RetryOpenDetail): (() => void) | undefined {
  if (!retryOpenRef.current) return undefined;
  return () => retryOpenRef.current?.(detail);
}

export function liveRetryMenuHandler(args: {
  session: SessionMeta | undefined;
  profile: CliProfile;
  workspace: Workspace;
  cliSessionId?: string;
  title: string;
}): (() => void) | undefined {
  if (args.session && args.session.kind !== "cli") return undefined;
  return retryMenuHandler({
    sessionId: args.session?.id,
    profileId: args.profile.id,
    engineName: args.profile.name,
    cliSessionId: args.cliSessionId,
    title: args.title,
    cwd: args.session?.cwd ?? args.workspace.root,
    workspaceId: args.workspace.id,
  });
}
