/**
 * 文件/会话 tab 右键菜单 —— 复刻 SessionContextMenu 的 wsmenu 范式
 * (portal + fixed + backdrop + Escape 关闭;plugins 的 clampMenuPosition
 * 不可反向 import,此处本地实现简化版视口夹取)。
 *
 * 关闭项集:关闭 / 关闭其他 tab / 关闭全部 tab —— 作用于被右键的 tab,
 * 不强制激活;dirty tab 的确认由关闭协调器统一把关(2026-10-13 起三项均经
 * requestClose* 过 kind 的 beforeClose 闸,见 kernel/tabClose.ts 与
 * docs/architecture/24-tab-close-guard.md)。
 * 分组(2026-10-20):会话 tab 菜单收成「重命名 / 置顶 / 通知▸ / 会话操作▸ / 标签页▸ /
 * 关闭」六行,低频项入二级子菜单;文件 tab 仅关闭族,保持平铺。
 * 分层:分组呈现(GroupedRows/CloseRows/menuLayout)在 TabMenuGroups,静音组在
 * TabMuteMenu,行原语(MenuRow/SubmenuRow)在 wsmenuSubmenu;本文件只剩
 * 壳:视口定位、开关、顶层高频行。
 */
import { createPortal } from "react-dom";
import { Pencil, Cross } from "@phosphor-icons/react";
import { MenuRow } from "./wsmenuSubmenu";
import { CloseRows, GroupedRows } from "./TabMenuGroups";
import { menuLayout } from "./tabMenuLayout";
import { t } from "@kernel/i18n";
import { useEscClose } from "@kernel/DialogShell";
import { useSettingsState } from "@kernel/settings";
import { clampToViewport } from "@kernel/menuClamp";
import { PinIcon } from "@kernel/PinIcon";

/** 菜单约 180 宽:以点击点为左上,在视口内夹取(kernel clampToViewport);高度按项数(行 30,分隔线约 14)。 */
function clampPosition(
  x: number,
  y: number,
  height: number,
): { x: number; y: number } {
  return clampToViewport(x, y, 180, height, 0);
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

/** 可选「置顶到全局/取消置顶」行:onTogglePin 恒传(会话 tab),canPin=false 禁用(未落盘不可扎)。 */
function PinMenuRow({
  onTogglePin,
  canPin,
  pinned,
  pick,
}: {
  onTogglePin?: () => void;
  canPin?: boolean;
  pinned?: boolean;
  pick: (run: () => void) => () => void;
}) {
  if (!onTogglePin) return null;
  return (
    <MenuRow
      icon={<PinIcon size="0.875rem" />}
      label={t(pinned ? "取消置顶" : "置顶到全局")}
      disabled={canPin === false}
      hint={canPin === false ? t("会话尚未落盘,暂不可置顶") : undefined}
      onPick={pick(onTogglePin)}
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
  const { grouped, height } = menuLayout({ onRename, onTogglePin, onView, onRelay, onLocate, muteKey, onToggleTile });
  const pos = clampPosition(position.x, position.y, height);

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
        <PinMenuRow onTogglePin={onTogglePin} canPin={canPin} pinned={pinned} pick={pick} />
        {grouped ? (
          <GroupedRows
            muteKey={muteKey}
            muteEntry={muteEntry}
            onView={onView}
            onRelay={onRelay}
            onLocate={onLocate}
            onToggleTile={onToggleTile}
            tileActive={tileActive}
            onCloseOthers={onCloseOthers}
            onCloseAll={onCloseAll}
            pick={pick}
          />
        ) : null}
        <MenuRow
          icon={<Cross size="0.875rem" />}
          label={t("关闭")}
          onPick={pick(onCloseTab)}
        />
        {!grouped ? <CloseRows onCloseOthers={onCloseOthers} onCloseAll={onCloseAll} pick={pick} /> : null}
      </div>
    </>,
    document.body,
  );
}
