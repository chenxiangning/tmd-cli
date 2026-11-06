/**
 * RPC 轮次结束 OS 通知 —— 自 ssSession 拆出守 300 行铁则。PTY 侧同闸同文案;
 * RPC 行静音覆盖层(isSsMuted,scope = 本会话存储域,同引擎同 cwd 并行会话
 * 互不串)先行;点击深链回本 tab(focusStructuredSessionTab)。
 */
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { sendOsNotification } from "@kernel/ipc";
import { getSettingsState } from "@kernel/settings";
import { focusStructuredSessionTab } from "@kernel/structuredSessionTabs";
import { isSsMuted } from "@kernel/structuredSessionOverlays";
import { shouldNotify, notifyText } from "@plugins/notify/logic";

export function notifyTurnEnd(profileId: string, cwd: string, scope: string, tabId: string): void {
  const { settings } = getSettingsState();
  if (isSsMuted(scope) || !shouldNotify("turnEnd", settings, host.isWindowFocused(), settings)) return;
  const name = `${host.getCliProfile(profileId)?.name ?? profileId} · ${t("带渲染的会话")}`;
  const { title, body } = notifyText("turnEnd", "", { getSessions: () => [] }, name);
  void sendOsNotification(title, body, () => focusStructuredSessionTab(tabId, profileId, cwd));
}
