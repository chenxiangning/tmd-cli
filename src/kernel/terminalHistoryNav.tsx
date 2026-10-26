/**
 * 幕布历史导航条 —— 「↑ 加载更早」与「↓ 回到最新」的顶部浮条。
 * 回到最新:⌘F 磁盘搜索深跳历史窗口后,幕布主体是日志窗而非活缓冲
 * (TerminalHistoryPager.isInJumpWindow),此前无出口只能滚轮狂滚;
 * 此条常驻直到回最新(重写为纯输出缓冲并贴底,见 resetToLatest)。
 */

import { t } from "@kernel/i18n";

const NAV_BTN_CLS =
  "rounded-md border border-(--tmd-border) bg-(--tmd-bg-popover) px-3 py-1 text-xs text-(--tmd-accent) shadow-(--tmd-shadow-popover) hover:bg-(--tmd-bg-hover) disabled:opacity-50";

export function TerminalHistoryNav(props: {
  atTop: boolean;
  hasMore: boolean;
  jumpWindow: boolean;
  loading: boolean;
  onLoadEarlier: () => void;
  onBackLatest: () => void;
}) {
  if (!props.jumpWindow && !(props.atTop && props.hasMore)) return null;
  return (
    <div className="absolute left-1/2 top-2 z-10 flex -translate-x-1/2 gap-1">
      {props.atTop && props.hasMore && (
        <button type="button" onClick={props.onLoadEarlier} disabled={props.loading} className={NAV_BTN_CLS}>
          {props.loading ? t("加载中…") : t("↑ 加载更早的输出")}
        </button>
      )}
      {props.jumpWindow && (
        <button type="button" onClick={props.onBackLatest} disabled={props.loading} className={NAV_BTN_CLS}>
          {t("浏览历史输出 · ↓ 回到最新")}
        </button>
      )}
    </div>
  );
}
