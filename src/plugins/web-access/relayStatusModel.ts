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

/** 状态点色类(CSS 圆点,非 emoji:仓库铁律不用 emoji,且彩点跨平台渲染不一致)。 */
export function relayStatusDot(info: RelayInfo | null): string {
  if (!info) return "bg-[var(--tmd-fg-faint)]";
  return info.connected ? "bg-[var(--tmd-ok)]" : "bg-[var(--tmd-warn)]";
}
