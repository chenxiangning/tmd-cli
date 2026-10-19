/**
 * 文件/会话 tab 右键菜单 —— 复刻 SessionContextMenu 的 wsmenu 范式
 * (portal + fixed + backdrop + Escape 关闭;plugins 的 clampMenuPosition
 * 不可反向 import,此处本地实现简化版视口夹取)。
 *
 * 关闭项集:关闭 / 关闭其他 tab / 关闭全部 tab —— 作用于被右键的 tab,
 * 不强制激活;dirty tab 的确认由关闭协调器统一把关(2026-10-13 起三项均经
 * requestClose* 过 kind 的 beforeClose 闸,见 kernel/tabClose.ts 与
 * docs/architecture/24-tab-close-guard.md)。
 * 可选首项「重命名」(传 onRename 启用,会话 tab 用):canRename=false 时禁用。
 * 会话 tab 的低频行内钮(查看转录/置顶/定位,2026-10-06 收敛)也在此挂:
 * onView/onLocate/onRelay 提供才显(接力行仅 CLI 会话 tab);onTogglePin 恒显
 * (canPin=false 禁用,未落盘不可扎)。
 */
import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Pencil,
  XSquare,
  Cross,
  XCircle,
  SquaresFour,
  EyeIcon,
  CrosshairSimple,
  ArrowSquareOut,
  Bell,
  BellSlash,
  Timer,
} from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { useEscClose } from "@kernel/DialogShell";
import { useSettingsState } from "@kernel/settings";
import { clampToViewport } from "@kernel/menuClamp";
import {
  SESSION_MUTE_MODES,
  muteSession,
  sessionMuteModeLabel,
  unmuteSession,
  type SessionMuteEntry,
  type SessionMuteMode,
} from "@kernel/sessionMutes";
import { PinIcon } from "@kernel/PinIcon";

/** 菜单约 180 宽:以点击点为左上,在视口内夹取(kernel clampToViewport);高度按项数(3 项基座 120,可选项各 30)。 */
function clampPosition(
  x: number,
  y: number,
  height: number,
): { x: number; y: number } {
  return clampToViewport(x, y, 180, height, 0);
}

/** 静音档位图标(与 SessionContextMenu 同款语义):铃/斜铃/计时。 */
const MUTE_MODE_ICONS: Record<SessionMuteMode, ReactNode> = {
  mute: <Bell size="0.875rem" />,
  full: <BellSlash size="0.875rem" />,
  snooze: <Timer size="0.875rem" />,
};

/** 静音组行数(高度估算用):未落盘 0 行;未静音 3 档;已静音 4 行(取消行 + 3 档)。 */
function muteMenuRowCount(hasGroup: boolean, muted: boolean): number {
  if (!hasGroup) return 0;
  return muted ? 4 : 3;
}

/** 菜单行:wsmenu-item 形制(icon + label),点击即执行并关菜单。 */
function MenuRow({
  icon,
  label,
  disabled,
  hint,
  onPick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  hint?: string;
  onPick: () => void;
}) {
  return (
    <button
      className="wsmenu-item"
      disabled={disabled}
      title={hint}
      onClick={onPick}
    >
      <span className="wsmenu-item-icon">{icon}</span>
      <span className="wsmenu-item-label">{label}</span>
    </button>
  );
}

/** 静音组:已静音首行「取消静音(当前档位括注)」;三档位行,当前档打勾并禁用。 */
function MuteMenuRows({
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

/** 可选首行「重命名」(会话 tab 用):未落盘(canRename=false)禁用并注明缘由。 */
function RenameMenuRow({
  onRename,
  canRename,
  pick,
}: {
  onRename?: () => void;
  canRename?: boolean;
  pick: (run: () => void) => () => void;
}) {
  if (!onRename) return null;
  return (
    <MenuRow
      icon={<Pencil size="0.875rem" />}
      label={t("重命名")}
      disabled={canRename === false}
      hint={canRename === false ? t("会话尚未落盘,暂不可命名") : undefined}
      onPick={pick(onRename)}
    />
  );
}

export function TabContextMenu({
  position,
  onRename,
  canRename,
  onView,
  onRelay,
  onTogglePin,
  canPin,
  pinned,
  muteKey,
  onLocate,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
  onClose,
  onToggleTile,
  tileActive,
}: {
  position: { x: number; y: number };
  /** 提供则首项显示「重命名」;canRename=false 时禁用(会话未落盘不可命名)。 */
  onRename?: () => void;
  canRename?: boolean;
  /** 提供则显示「查看会话转录(只读)」(会话 tab:行内钮收敛后低频入口)。 */
  onView?: () => void;
  /** 提供则显示「转到其他引擎接力…」(CLI 会话 tab;插件经 relayLiveRef 在册)。 */
  onRelay?: () => void;
  /** 提供则显示「置顶到全局/取消置顶」;canPin=false 时禁用(未落盘不可扎)。 */
  onTogglePin?: () => void;
  canPin?: boolean;
  pinned?: boolean;
  /** 静音覆盖层 key;undefined = 不可静音(未落盘,整组隐藏,同 SessionContextMenu)。 */
  muteKey?: string;
  /** 提供则显示「在左侧栏定位会话」。 */
  onLocate?: () => void;
  onCloseTab: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
  onClose: () => void;
  /** 提供则显示「平铺显示/取消平铺」切换项(会话 tab 条用,全局开关)。 */
  onToggleTile?: () => void;
  tileActive?: boolean;
}) {
  /* 静音档随 settings 订阅实时;undefined = 未落盘(整组隐藏)。 */
  const { settings } = useSettingsState();
  const muteEntry = muteKey === undefined ? undefined : (settings.sessionMutes[muteKey] ?? null);
  /* 高度按实显项数估算(3 项基座 120,可选项各 30)——只用于夹取,真值由内容撑开。 */
  const optionalRows =
    [onRename, onView, onRelay, onTogglePin, onLocate, onToggleTile].filter(Boolean).length +
    muteMenuRowCount(muteKey !== undefined, Boolean(muteEntry));
  const pos = clampPosition(position.x, position.y, 120 + optionalRows * 30);

  useEscClose(onClose);
  const pick = (run: () => void) => () => {
    run();
    onClose();
  };

  return createPortal(
    <>
      <div
        className="wsmenu-backdrop"
        role="presentation"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div className="wsmenu session-menu tmd-scroll-hide" style={{ left: pos.x, top: pos.y }} data-icon-decor="menu">
        <RenameMenuRow onRename={onRename} canRename={canRename} pick={pick} />
        {onView ? (
          <MenuRow
            icon={<EyeIcon size="0.875rem" />}
            label={t("查看会话转录(只读)")}
            onPick={pick(onView)}
          />
        ) : null}
        {onRelay ? (
          <MenuRow
            icon={<ArrowSquareOut size="0.875rem" />}
            label={t("转到其他引擎接力…")}
            onPick={pick(onRelay)}
          />
        ) : null}
        {onTogglePin ? (
          <MenuRow
            icon={<PinIcon size="0.875rem" />}
            label={t(pinned ? "取消置顶" : "置顶到全局")}
            disabled={canPin === false}
            hint={canPin === false ? t("会话尚未落盘,暂不可置顶") : undefined}
            onPick={pick(onTogglePin)}
          />
        ) : null}
        {muteKey !== undefined ? (
          <MuteMenuRows muteKey={muteKey} muteEntry={muteEntry} pick={pick} />
        ) : null}
        {onLocate ? (
          <MenuRow
            icon={<CrosshairSimple size="0.875rem" />}
            label={t("在左侧栏定位会话")}
            onPick={pick(onLocate)}
          />
        ) : null}
        {onToggleTile ? (
          <MenuRow
            icon={<SquaresFour size="0.875rem" />}
            label={tileActive ? t("取消平铺") : t("平铺显示")}
            onPick={pick(onToggleTile)}
          />
        ) : null}
        <MenuRow
          icon={<Cross size="0.875rem" />}
          label={t("关闭")}
          onPick={pick(onCloseTab)}
        />
        <MenuRow
          icon={<XSquare size="0.875rem" />}
          label={t("关闭其他 tab")}
          onPick={pick(onCloseOthers)}
        />
        <MenuRow
          icon={<XCircle size="0.875rem" />}
          label={t("关闭全部 tab")}
          onPick={pick(onCloseAll)}
        />
      </div>
    </>,
    document.body,
  );
}
