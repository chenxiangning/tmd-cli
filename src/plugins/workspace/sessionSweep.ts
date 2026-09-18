/**
 * 会话卫生清扫 —— 超期会话自动归档 + 空会话物理删除
 * (spec: docs/superpowers/specs/2026-09-19-session-hygiene-auto-archive-design.md)。
 *
 * 零轮询:挂在 useCliDiskScan 的扫描结算点(本机/远程两分支),扫描本身
 * 事件驱动(展开工作区/手动刷新/绑定跳变/标题补扫),不新增任何触发面。
 * 写归档走覆盖层批量入口(archiveSessions,单次写盘);空会话删除复用
 * sessionOps.deleteDiskSessionFull(先杀后删 + 清覆盖层 + tombstone,
 * 删盘失败自动降级为已归档+隐藏)。
 *
 * 远程扫描分支只归档不删盘:本地 fsRemovePath 碰不到远端文件,
 * 删了列表消失而远端数据还在,重扫复活成幽灵。
 */

import type { CliDiskSession, CliProfile } from "@kernel/cli";
import { getSettingsState } from "@kernel/settings";
import {
  archiveSessions,
  isSessionArchived,
  sessionArchiveKey,
} from "@kernel/sessionArchive";
import { isSessionDeleted, sessionDeletedKey } from "@kernel/sessionDeleted";
import { isSessionKept, sessionKeepKey } from "@kernel/sessionKeep";
import type { Workspace } from "@kernel/workspace";
import { deleteDiskSessionFull } from "./sessionOps";

/** 返回删除的会话数(>0 时调用方补扫一次,让行即时消失)。 */
export async function sweepStaleSessions(opts: {
  profile: CliProfile;
  workspace: Workspace;
  /** 本次扫描结算的全量磁盘会话。 */
  sessions: CliDiskSession[];
  /** 活会话已绑定的磁盘身份(正在跑的不归档)。 */
  liveCliIds: Set<string>;
  /** 远程扫描分支传 false:只归档不删盘(见文件头)。 */
  allowDelete: boolean;
}): Promise<number> {
  const { profile, workspace, sessions, liveCliIds, allowDelete } = opts;
  const settings = getSettingsState().settings;
  if (!settings.sessionHygieneEnabled) return 0;
  const staleMs = settings.sessionHygieneHours * 3_600_000;
  const now = Date.now();

  const candidates: CliDiskSession[] = [];
  const keys: string[] = [];
  for (const s of sessions) {
    /* modifiedAt<=0(grok/dsh 时间未知)永不扫:0 = 缺时间戳,不是「无限老」。 */
    if (s.modifiedAt <= 0 || now - s.modifiedAt <= staleMs) continue;
    if (liveCliIds.has(s.id)) continue;
    const key = sessionArchiveKey(workspace.id, profile.id, s.id);
    /* 幂等 + 用户意图门控:已归档/已删/手动保留/置顶 一律跳过。
       置顶与归档 key 同构(三段身份),pins 直查同 key。 */
    if (isSessionArchived(key)) continue;
    if (isSessionDeleted(sessionDeletedKey(workspace.id, profile.id, s.id))) continue;
    if (isSessionKept(sessionKeepKey(workspace.id, profile.id, s.id))) continue;
    if (settings.sessionPins[key] !== undefined) continue;
    candidates.push(s);
    keys.push(key);
  }
  if (keys.length === 0) return 0;

  archiveSessions(keys);
  if (!allowDelete || !profile.isDiskSessionEmpty) return 0;
  /* 候选彼此独立(各自判空 + 删盘),并发一轮;超期候选常态个位数,Promise.all 足够。
     判空钩子契约保守(任何不确定 false),catch 再兜一层。 */
  const results = await Promise.all(
    candidates.map(async (s) => {
      const empty = await profile.isDiskSessionEmpty!(s).catch(() => false);
      if (!empty) return false;
      await deleteDiskSessionFull(profile, s, workspace.id);
      return true;
    }),
  );
  return results.filter((deleted) => deleted).length;
}
