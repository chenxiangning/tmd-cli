/**
 * notify 纯逻辑 ── 通知发送闸与文案(模块级纯函数,单测覆盖)。
 * host 仅以最小结构面注入(会话查名),不直依赖内核单例。
 */

import { t } from "@kernel/i18n";

/** 会话查名最小面(生产传 host,测试传桩)。 */
export interface SessionLookup {
  getSessions(): Array<{ id: string; profileId: string; title?: string }>;
}

/** 通知类别:Ask 等待确认 / 轮次结束 / 会话退出。 */
export type NotifyKind = "ask" | "turnEnd" | "exit";

/** 分类开关(settings 的子集;键名与 kernel/settingsTypes 对齐)。 */
export interface NotifyPrefs {
  notifyOsAsk: boolean;
  notifyOsTurnEnd: boolean;
  notifyOsSessionExit: boolean;
}

/**
 * 发送闸:窗口聚焦 = 用户在场,一切通知静默(chip/呼吸灯/提示音已足够);
 * 失焦时按分类开关放行。
 */
export function shouldNotify(
  kind: NotifyKind,
  prefs: NotifyPrefs,
  windowFocused: boolean,
): boolean {
  if (windowFocused) return false;
  if (kind === "ask") return prefs.notifyOsAsk;
  if (kind === "turnEnd") return prefs.notifyOsTurnEnd;
  return prefs.notifyOsSessionExit;
}

/** 会话显示名:title 覆盖(SSH=主机名/重命名)> profileId > 裸 id。 */
function sessionName(sessionId: string, lookup: SessionLookup): string {
  const meta = lookup.getSessions().find((s) => s.id === sessionId);
  return meta?.title || meta?.profileId || sessionId;
}

/** 各通知类别的标题与正文;displayName 显式覆盖(退出场景会话已不在表)。 */
export function notifyText(
  kind: NotifyKind,
  sessionId: string,
  lookup: SessionLookup,
  displayName?: string,
): { title: string; body: string } {
  const name = displayName || sessionName(sessionId, lookup);
  if (kind === "ask")
    return { title: t("等待确认"), body: t("「{name}」在等你确认操作", { name }) };
  if (kind === "turnEnd")
    return { title: t("轮次结束"), body: t("「{name}」完成了一轮对话", { name }) };
  return { title: t("会话退出"), body: t("「{name}」已退出", { name }) };
}
