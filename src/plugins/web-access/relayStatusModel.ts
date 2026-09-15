/**
 * WebRelayCard 状态文案纯函数(自 WebRelayCard.tsx 拆出,
 * only-export-components / no-high-complexity)。
 */

import type { RelayInfo } from "@kernel/ipc";
import { t } from "@kernel/i18n";

export function relayStatusText(info: RelayInfo | null): string {
  if (!info) return t("未连接");
  if (info.connected) return t("已连接");
  if (info.error) return info.error;
  return t("连接中…");
}

export function relayStatusDot(info: RelayInfo | null): string {
  if (!info) return "⚪";
  return info.connected ? "🟢" : "🟡";
}
