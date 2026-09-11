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

export interface BroadcastTarget {
  id: string;
  profile: CliProfile;
}

export function resolveBroadcastTargets(
  tabIds: readonly string[],
  activeId: string | null,
  sessions: readonly SessionMeta[],
  getProfile: (profileId: string) => CliProfile | undefined,
): BroadcastTarget[] {
  /* kept 公式与 MainPanel 保活集合逐字同构(activeId 不在条内的边缘路径补挂) */
  const kept = activeId && !tabIds.includes(activeId) ? [...tabIds, activeId] : tabIds;
  const out: BroadcastTarget[] = [];
  for (const id of kept) {
    const s = sessions.find((x) => x.id === id);
    const p = s ? getProfile(s.profileId) : undefined;
    if (p) out.push({ id, profile: p });
  }
  return out;
}
