/**
 * 平铺广播目标解析 —— 纯函数(单测面)。
 *
 * 语义:对话框草稿一次性喂给「平铺显示」里全部幕布会话。目标集 = MainPanel 平铺
 * 同款 kept 公式(tab 条 ids + 活跃兜底),逐目标解析其 CLI profile;无会话/无
 * profile(ssh/shell 幕布无 composer 语义)跳过。发送管线复用 prepareSendPayload
 * (translate/bracketedPaste 差异零新代码)。
 */

import type { CliProfile } from "@kernel/cli";
import type { SessionMeta } from "@kernel/ipc";

interface BroadcastTarget {
  id: string;
  profile: CliProfile;
}

/** kept 公式唯一源:与 MainPanel 保活集合逐字同构(activeId 不在条内的边缘路径补挂)。
 *  广播目标解析与确认弹层幕布位序共用,防两处序漂移。 */
export function keptSessionIds(
  tabIds: readonly string[],
  activeId: string | null,
): string[] {
  return activeId && !tabIds.includes(activeId) ? [...tabIds, activeId] : [...tabIds];
}

export function resolveBroadcastTargets(
  tabIds: readonly string[],
  activeId: string | null,
  sessions: readonly SessionMeta[],
  getProfile: (profileId: string) => CliProfile | undefined,
): BroadcastTarget[] {
  const byId = new Map(sessions.map((x) => [x.id, x] as const));
  const out: BroadcastTarget[] = [];
  for (const id of keptSessionIds(tabIds, activeId)) {
    const s = byId.get(id);
    const p = s ? getProfile(s.profileId) : undefined;
    if (p) out.push({ id, profile: p });
  }
  return out;
}
