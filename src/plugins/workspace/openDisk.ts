/**
 * 磁盘行统一打开出口(R-ISO1 入口隔离):已知 RPC 身份的磁盘行点按
 * 按带渲染会话 resume 重开(structured tab,与活 RPC 行/「继续对话」
 * 菜单同出口),其余走 PTY/来源插件既有路。判定 = 引擎支持 RPC resume 且
 * (全局 RPC 身份记忆 tmd.ss.rpcids 命中 或 本工作区上次 RPC 会话
 * tmd.ss.last 命中)。远程工作区一律先交来源插件,不本地重开。
 */

import type { CliDiskSession, CliProfile } from "@kernel/cli";
import type { Workspace } from "@kernel/workspace";
import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import {
  isSsRpcSession,
  openStructuredSessionTab,
  readLastSsSession,
} from "@kernel/structuredSessionTabs";
import { isClosedSsBusy } from "@kernel/structuredSessionEnded";
import { noteSessionTabTitle } from "@kernel/sessionTabs";

/** 磁盘行是否为可重开的 RPC 会话(行徽标与点按分流同一判据)。 */
export function isRpcDiskSession(profile: CliProfile, workspace: Workspace, s: CliDiskSession): boolean {
  return (
    profile.structuredRpc?.resumeArgs != null &&
    (isSsRpcSession(s.id) || readLastSsSession(profile.id, workspace.root) === s.id)
  );
}

/** 磁盘行点按:远程 → 来源插件;RPC → 带渲染 resume;其余 → PTY 打开。 */
export function openDiskSessionEntry(
  profile: CliProfile,
  workspace: Workspace,
  s: CliDiskSession,
  displayTitle: (cliSessionId: string, fallbackId: string) => string,
): void {
  host.events.emit(KernelTopics.sessionViewRequested, null); /* 用户手势,摘最大化 */
  /* 远程磁盘会话:来源插件接管 resume(如 WSL 的 SSH 包装 + 引擎 --resume)。 */
  if (findWorkspaceOrigin(workspace)?.openRemoteDiskSession?.(workspace, profile, s.id)) return;
  /* RPC 磁盘行:按带渲染会话重开(关闭 tab 后从工作区列表原路回 RPC);
   * busy 中关闭的账本旗随行(种子剪尾防在途轮重放重复)。 */
  if (isRpcDiskSession(profile, workspace, s)) {
    openStructuredSessionTab(profile.id, workspace.root, { resumeSessionId: s.id, resumeUnsettled: isClosedSsBusy(s.id) });
    return;
  }
  void host
    .openDiskSession(profile.id, workspace.root, workspace.id, s.id)
    .then((meta) => noteSessionTabTitle(meta.id, displayTitle(s.id, s.id)))
    .catch(() => undefined);
}
