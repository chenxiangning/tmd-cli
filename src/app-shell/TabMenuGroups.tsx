/**
 * tab 右键菜单的分组呈现层(2026-10-20 分组化自 TabContextMenu 拆出)。
 * GroupedRows = 通知/会话操作/标签页三个二级子菜单 + 尾分隔线;
 * CloseRows = 关闭其他/全部两行(平铺态与标签页子菜单共用)。
 * 布局估算/分组判定在 tabMenuLayout.ts,静音组在 TabMuteMenu,行原语在 wsmenuSubmenu。
 */
import {
  XSquare,
  XCircle,
  SquaresFour,
  EyeIcon,
  CrosshairSimple,
  ArrowSquareOut,
  Bell,
  ChatCircleDots,
  CornersOut,
} from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { SessionMuteEntry } from "@kernel/sessionMutes";
import { MenuRow, SubmenuRow } from "./wsmenuSubmenu";
import { MuteMenuRows } from "./TabMuteMenu";

/** 批量关闭两行:关闭其他 / 关闭全部(作用于被右键的 tab,不强制激活)。 */
export function CloseRows({
  onCloseOthers,
  onCloseAll,
  pick,
}: {
  onCloseOthers: () => void;
  onCloseAll: () => void;
  pick: (run: () => void) => () => void;
}) {
  return (
    <>
      <MenuRow icon={<XSquare size="0.875rem" />} label={t("关闭其他 tab")} onPick={pick(onCloseOthers)} />
      <MenuRow icon={<XCircle size="0.875rem" />} label={t("关闭全部 tab")} onPick={pick(onCloseAll)} />
    </>
  );
}

/** 分组区:通知/会话操作/标签页三个二级子菜单 + 尾分隔线(会话 tab 专用)。 */
export function GroupedRows({
  muteKey,
  muteEntry,
  onView,
  onRelay,
  onLocate,
  onToggleTile,
  tileActive,
  onCloseOthers,
  onCloseAll,
  pick,
}: {
  muteKey?: string;
  muteEntry: SessionMuteEntry | null | undefined;
  onView?: () => void;
  onRelay?: () => void;
  onLocate?: () => void;
  onToggleTile?: () => void;
  tileActive?: boolean;
  onCloseOthers: () => void;
  onCloseAll: () => void;
  pick: (run: () => void) => () => void;
}) {
  return (
    <>
      {muteKey !== undefined ? (
        <SubmenuRow icon={<Bell size="0.875rem" />} label={t("通知")}>
          <MuteMenuRows muteKey={muteKey} muteEntry={muteEntry} pick={pick} />
        </SubmenuRow>
      ) : null}
      {onView || onRelay || onLocate ? (
        <SubmenuRow icon={<ChatCircleDots size="0.875rem" />} label={t("会话操作")}>
          {onView ? (
            <MenuRow icon={<EyeIcon size="0.875rem" />} label={t("查看会话转录(只读)")} onPick={pick(onView)} />
          ) : null}
          {onRelay ? (
            <MenuRow icon={<ArrowSquareOut size="0.875rem" />} label={t("转到其他引擎接力…")} onPick={pick(onRelay)} />
          ) : null}
          {onLocate ? (
            <MenuRow icon={<CrosshairSimple size="0.875rem" />} label={t("在左侧栏定位会话")} onPick={pick(onLocate)} />
          ) : null}
        </SubmenuRow>
      ) : null}
      <SubmenuRow icon={<SquaresFour size="0.875rem" />} label={t("标签页")}>
        {onToggleTile ? (
          <MenuRow
            icon={<CornersOut size="0.875rem" />}
            label={tileActive ? t("取消平铺") : t("平铺显示")}
            onPick={pick(onToggleTile)}
          />
        ) : null}
        <CloseRows onCloseOthers={onCloseOthers} onCloseAll={onCloseAll} pick={pick} />
      </SubmenuRow>
      <div className="wsmenu-divider" />
    </>
  );
}
