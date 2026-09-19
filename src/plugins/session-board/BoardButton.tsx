/**
 * 会话看板入口按钮 —— 头部左区按钮簇(header.leftCluster 挂点贡献)。
 *
 * 点击:开关看板覆盖层(市场页同款切换效果,非 tab);
 * 激活态随覆盖层 store(useSyncExternalStore)。
 */
import { useSyncExternalStore } from "react";
import { CalendarDots } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import {
  boardOverlayOpen,
  subscribeBoardOverlay,
  toggleBoardOverlay,
} from "./boardOverlayStore";

export function BoardButton() {
  const isActive = useSyncExternalStore(subscribeBoardOverlay, boardOverlayOpen);
  const label = t("会话看板");
  return (
    <button
      type="button"
      className={`titlebar-action${isActive ? " is-active" : ""}`}
      aria-label={label}
      data-hint={label}
      onClick={toggleBoardOverlay}
    >
      <CalendarDots size="0.875rem" aria-hidden />
    </button>
  );
}
