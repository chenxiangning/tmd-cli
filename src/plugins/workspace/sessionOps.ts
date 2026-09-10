/**
 * 会话删除助手 —— 自 SessionList/LiveSessionRow 拆出(文件规模铁则)。
 * 普通视图(右键菜单)与管理模式(行按钮/批量条)共用同一删除语义。
 *
 * 删除意图原则:删除被调用 = 用户意图就是删除,意图归 tmd-cli 所有 ——
 * 后台删盘(fs_remove_path / 单库 CLI 的 deleteSession 钩子)失败报错时,
 * 管理态清理(命名/置顶/归档覆盖层 + 删除意图 tombstone)照常生效,列表全域
 * 隐藏,不让会话在重扫中复活;磁盘数据保留,console.warn 诊断。后台成功路径
 * 同样在册(id 不复用,残留 key 无害,顺带让重扫前的窗口期即时隐藏)。
 */

import type { CliDiskSession, CliProfile } from "@kernel/cli";
import { host } from "@kernel/host";
import { ipc, type SessionMeta } from "@kernel/ipc";
import { removeSessionTitle } from "@kernel/sessionTitles";
import { sessionPinKey, unpinSession } from "@kernel/sessionPins";
import { sessionArchiveKey, unarchiveSession } from "@kernel/sessionArchive";
import { markSessionDeleted, sessionDeletedKey } from "@kernel/sessionDeleted";

/** 后台删除一个磁盘会话文件(或经单库 CLI 的代写钩子);失败不抛,返回是否成功。 */
async function removeDiskSessionBestEffort(
  profile: CliProfile,
  session: CliDiskSession,
): Promise<boolean> {
  try {
    if (profile.deleteSession) {
      await profile.deleteSession(session.id);
    } else {
      await ipc.fsRemovePath(session.path);
    }
    return true;
  } catch (e) {
    console.warn(
      "后台删除会话文件失败(已从 tmd-cli 移除并隐藏,磁盘数据保留):",
      session.path,
      e,
    );
    return false;
  }
}

/** 清命名/置顶/归档覆盖层 + 记删除意图(tombstone)。 */
function clearOverlaysAndMark(workspaceId: string, profileId: string, cliSessionId: string): void {
  removeSessionTitle(profileId, cliSessionId);
  unpinSession(sessionPinKey(workspaceId, profileId, cliSessionId));
  unarchiveSession(sessionArchiveKey(workspaceId, profileId, cliSessionId));
  markSessionDeleted(sessionDeletedKey(workspaceId, profileId, cliSessionId));
}

/** 删除磁盘会话 + 清命名/置顶/归档覆盖层。调用方负责触发本地重扫。 */
export async function deleteDiskSessionFull(
  profile: CliProfile,
  session: CliDiskSession,
  workspaceId: string,
): Promise<void> {
  /* 先杀后删(与 deleteLiveSessionFull 同一时序契约):被删磁盘会话可能正以
   * 活会话身份运行(归档视图/管理模式里它以磁盘行形出现)——只删盘不杀,
   * 流式中的 CLI 会把文件重新写出来,分组被 tombstone 隐藏而进程成幽灵。 */
  await Promise.all(
    host
      .getSessions()
      .flatMap((s) =>
        s.profileId === profile.id && host.getCliSessionId(s.id) === session.id
          ? [host.removeSession(s.id)]
          : [],
      ),
  );
  await removeDiskSessionBestEffort(profile, session);
  clearOverlaysAndMark(workspaceId, profile.id, session.id);
}

/**
 * 删除活会话:kill PTY + 物理删除已绑定磁盘会话(双端统一) + 清命名/置顶/归档覆盖。
 * 顺序即正确性:先杀 PTY 再删盘 —— SIGKILL 后进程不再可能写文件;反过来删,
 * 流式中的 CLI 会在「删完到 kill 生效」的缝隙里按路径重开文件,会话死而复生。
 * diskSessions = 本组最近一次磁盘扫描结果;懒落盘/补扫间隙(快照里还没有该文件,
 * 实证 omp 首写晚于 spawn 35s+)用现扫按身份反查兜底,否则 kill 后文件幸存,
 * 重扫又把它列回来 —— 同样表现为"删不掉"。未绑定(尚未落盘)只 kill,无盘可删。
 */
export async function deleteLiveSessionFull(
  profile: CliProfile,
  session: SessionMeta,
  workspaceId: string,
  workspaceRoot: string,
  diskSessions: CliDiskSession[],
): Promise<void> {
  const cliSessionId = host.getCliSessionId(session.id);
  await host.removeSession(session.id);
  if (!cliSessionId) return;
  let entry = diskSessions.find((s) => s.id === cliSessionId);
  if (!entry && profile.listSessions) {
    const fresh = await profile.listSessions(workspaceRoot).catch(() => []);
    entry = fresh.find((s) => s.id === cliSessionId);
  }
  if (entry) await removeDiskSessionBestEffort(profile, entry);
  clearOverlaysAndMark(workspaceId, profile.id, cliSessionId);
}
