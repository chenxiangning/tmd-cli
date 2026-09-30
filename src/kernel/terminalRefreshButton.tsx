/**
 * 幕布刷新钮 —— 单会话幕布重建的手动出口(受控组件,重建由 TerminalView
 * 的 canvasGen 代数驱动:xterm 销毁重建 + 输出缓冲回放 + 强制 SIGWINCH
 * 整帧重绘,PTY/CLI 全程不中断)。
 *
 * 定位:session-viewer「转录」浮标(.lv-float,top 8/right 12)正下方一列,
 * 同列同宽视觉对齐,互不重叠;浮标缺席时独自守右上角下方,无依赖耦合
 * (kernel 不感知插件能力门)。样式对齐 lv-pill 量级(22px 高/0.6875rem)。
 * 与整页 reload 的分工:这里是会话内自救(幕布错乱/内容滞留);WebKit 级
 * 像素冻结由守望阶梯自动自愈(render_health),不经此钮。
 */
import { ArrowClockwise } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";

export function TerminalRefreshButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      title={t("刷新幕布(重建本会话终端画面,PTY 不中断)")}
      onClick={onClick}
      className="absolute right-3 top-10 z-20 flex h-[22px] w-[26px] items-center justify-center rounded-md border border-(--tmd-border) bg-(--tmd-bg-popover) text-(--tmd-fg-muted) opacity-70 transition-opacity hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg) hover:opacity-100"
    >
      <ArrowClockwise className="size-3.5" />
    </button>
  );
}
