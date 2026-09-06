/**
 * 会话删除助手 —— 自 SessionList/LiveSessionRow 拆出(文件规模铁则)。
 * 普通视图(右键菜单)与管理模式(行按钮/批量条)共用同一删除语义:
 * - removeDiskSession:物理删除磁盘会话(profile 声明 deleteSession 的单库 CLI
 *   走代写钩子并让错误冒泡给调用方提示;否则照旧删文件/目录)
 * - deleteDiskSessionFull / deleteLiveSessionFull:物理删除 + 清命名/置顶/归档
 *   覆盖层(覆盖层以 CLI 身份为 key,文件没了覆盖层也必须跟着消失)
 */

import type { CliDiskSession, CliProfile } from "@kernel/cli";
import { host } from "@kernel/host";
import { ipc, type SessionMeta } from "@kernel/ipc";
import { removeSessionTitle } from "@kernel/sessionTitles";
import { sessionPinKey, unpinSession } from "@kernel/sessionPins";
import { sessionArchiveKey, unarchiveSession } from "@kernel/sessionArchive";

/** 物理删除一个磁盘会话文件(或经单库 CLI 的代写钩子)。 */
export async function removeDiskSession(
  profile: CliProfile,
  session: CliDiskSession,
): Promise<void> {
  if (profile.deleteSession) {
    await profile.deleteSession(session.id);
    return;
  }
  await ipc.fsRemovePath(session.path).catch(() => undefined);
}

/** 删除磁盘会话 + 清命名/置顶/归档覆盖层。调用方负责触发本地重扫。 */
export async function deleteDiskSessionFull(
  profile: CliProfile,
  session: CliDiskSession,
  workspaceId: string,
): Promise<void> {
  await removeDiskSession(profile, session);
  removeSessionTitle(profile.id, session.id);
  removeSessionTitle(profile.id, session.id);
  unpinSession(sessionPinKey(workspaceId, profile.id, session.id));
  unarchiveSession(sessionArchiveKey(workspaceId, profile.id, session.id));
}

/**
 * 删除活会话:物理删除已绑定磁盘会话(双端统一) + kill PTY + 清命名/置顶/归档覆盖。
 * diskSessions = 本组最近一次磁盘扫描结果(绑定身份 → 文件条目反查)。
 */
export async function deleteLiveSessionFull(
  profile: CliProfile,
  session: SessionMeta,
  workspaceId: string,
  diskSessions: CliDiskSession[],
): Promise<void> {
  const cliSessionId = host.getCliSessionId(session.id);
  const entry = cliSessionId
    ? diskSessions.find((s) => s.id === cliSessionId)
    : undefined;
  if (entry) await removeDiskSession(profile, entry);
  if (cliSessionId) {
    removeSessionTitle(profile.id, cliSessionId);
    unpinSession(sessionPinKey(workspaceId, profile.id, cliSessionId));
    unarchiveSession(sessionArchiveKey(workspaceId, profile.id, cliSessionId));
  }
  await host.removeSession(session.id);
}
