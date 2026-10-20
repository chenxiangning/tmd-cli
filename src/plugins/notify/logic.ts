/**
 * notify 纯逻辑 ── 通知发送闸与文案(模块级纯函数,单测覆盖)。
 * host 仅以最小结构面注入(会话查名),不直依赖内核单例。
 */

import { t } from "@kernel/i18n";
import { isDndActive, type DndPrefs } from "@kernel/dnd";

/** 会话查名最小面(生产传 host,测试传桩)。 */
export interface SessionLookup {
  getSessions(): Array<{ id: string; profileId: string; title?: string }>;
}

/** 回跳决策最小面(生产传 host,测试传桩)。 */
export interface SessionReopenHost {
  getSessions(): Array<{ id: string }>;
  setActiveSession(id: string): void;
  openDiskSession(
    profileId: string,
    cwd: string,
    workspaceId: string | undefined,
    cliSessionId: string,
  ): Promise<unknown>;
}

/** 通知类别:Ask 等待确认 / 轮次结束 / 会话退出 / 额度预警。 */
export type NotifyKind = "ask" | "turnEnd" | "exit" | "quota";

/** 分类开关(settings 的子集;键名与 kernel/settingsTypes 对齐)。 */
export interface NotifyPrefs {
  notifyOsAsk: boolean;
  notifyOsTurnEnd: boolean;
  notifyOsSessionExit: boolean;
  notifyOsQuota: boolean;
}

/**
 * 发送闸:窗口聚焦 = 用户在场,一切通知静默(chip/呼吸灯/提示音已足够);
 * 失焦时按分类开关放行;dnd 免打扰窗(可选,生产传 settings)内再静默 ——
 * 三闸之一,另两闸在 kernel/askSound 与 kernel/turnSound。流水不受此闸。
 */
export function shouldNotify(
  kind: NotifyKind,
  prefs: NotifyPrefs,
  windowFocused: boolean,
  dnd?: DndPrefs,
): boolean {
  if (windowFocused) return false;
  if (dnd && isDndActive(dnd)) return false;
  if (kind === "ask") return prefs.notifyOsAsk;
  if (kind === "turnEnd") return prefs.notifyOsTurnEnd;
  if (kind === "quota") return prefs.notifyOsQuota;
  return prefs.notifyOsSessionExit;
}

/** 会话显示名:title 覆盖(SSH=主机名/重命名)> profileId > 裸 id。 */
function sessionName(sessionId: string, lookup: SessionLookup): string {
  const meta = lookup.getSessions().find((s) => s.id === sessionId);
  return meta?.title || meta?.profileId || sessionId;
}

/** 通知中心行回跳决策:活会话直接聚焦;tab 已关/应用重启过的按记录时刻的
 *  磁盘身份快照 resume 重开(与侧栏磁盘行同语义);无快照(旧流水)到此为止。
 *  spawn 失败静默 —— sessionStartFailed 广播已由 StartFailureToast 呈现。 */
export function reopenNotifySession(
  target: {
    sessionId: string;
    profileId?: string;
    cwd?: string;
    workspaceId?: string;
    cliSessionId?: string;
  },
  h: SessionReopenHost,
): void {
  if (h.getSessions().some((s) => s.id === target.sessionId)) {
    h.setActiveSession(target.sessionId);
    return;
  }
  if (target.profileId && target.cwd && target.cliSessionId) {
    void h
      .openDiskSession(target.profileId, target.cwd, target.workspaceId, target.cliSessionId)
      .catch(() => undefined);
  }
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
  if (kind === "quota")
    return { title: t("额度预警"), body: t("「{name}」的额度需要关注", { name }) };
  return { title: t("会话退出"), body: t("「{name}」已退出", { name }) };
}
