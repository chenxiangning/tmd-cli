/**
 * tab 右键菜单的通知静音组(2026-10-20 分组化时自 TabContextMenu 拆出)。
 * 已静音首行「取消静音(当前档位括注)」;三档位行,当前档打勾并禁用。
 */
import { type ReactNode } from "react";
import { Bell, BellSlash, Timer } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { MenuRow } from "./wsmenuSubmenu";
import {
  SESSION_MUTE_MODES,
  muteSession,
  sessionMuteModeLabel,
  unmuteSession,
  type SessionMuteEntry,
  type SessionMuteMode,
} from "@kernel/sessionMutes";

/** 静音档位图标(与 SessionContextMenu 同款语义):铃/斜铃/计时。 */
const MUTE_MODE_ICONS: Record<SessionMuteMode, ReactNode> = {
  mute: <Bell size="0.875rem" />,
  full: <BellSlash size="0.875rem" />,
  snooze: <Timer size="0.875rem" />,
};

export function MuteMenuRows({
  muteKey,
  muteEntry,
  pick,
}: {
  muteKey: string;
  muteEntry: SessionMuteEntry | null | undefined;
  pick: (run: () => void) => () => void;
}) {
  return (
    <>
      {muteEntry ? (
        <MenuRow
          icon={<BellSlash size="0.875rem" />}
          label={t("取消静音({mode})", { mode: sessionMuteModeLabel(muteEntry.mode) })}
          onPick={pick(() => {
            unmuteSession(muteKey);
          })}
        />
      ) : null}
      {SESSION_MUTE_MODES.map((mode) => (
        <MenuRow
          key={mode}
          icon={MUTE_MODE_ICONS[mode]}
          label={muteEntry?.mode === mode ? `✓ ${sessionMuteModeLabel(mode)}` : sessionMuteModeLabel(mode)}
          disabled={muteEntry?.mode === mode}
          onPick={pick(() => {
            muteSession(muteKey, mode);
          })}
        />
      ))}
    </>
  );
}
