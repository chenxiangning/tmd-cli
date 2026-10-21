/**
 * 幕布工具钮(terminalRefreshButton.tsx)—— 刷新重建 + 回底贴底两颗图标 pill:
 * 幕布右上工具行(TerminalView 行容器,right 12/top 8)插件挂点后并排,刷新收尾最右。
 *
 * - 刷新钮:单会话幕布重建的手动出口(受控组件,重建由 TerminalView 的
 *   canvasGen 代数驱动:xterm 销毁重建 + 输出缓冲回放 + 强制 SIGWINCH 整帧重绘,
 *   PTY/CLI 全程不中断)。与整页 reload 的分工:这里是会话内自救(幕布错乱/
 *   内容滞留);WebKit 级像素冻结由守望阶梯自动自愈(render_health),不经此钮。
 * - 回底钮:深翻历史后一键贴底(纯视口操作,不动 PTY/缓冲);与「加载更早
 *   的输出」pill 是一对出口:上翻出 pill,回底钮收回。
 * - 图标装饰纳管(家族键,2026-10-22):data-icon-decor 消费
 *   --icon-decor-terminal-refresh / -terminal-jump-bottom,取色与呼吸闪烁在
 *   设置/外观/图标装饰可调;缺省回落 currentColor,像素零变化。
 * 形制:22px 高/6px 圆角/半透明 elevated 底 + 4px 毛玻璃,纯图标无文字。
 */
import { ArrowClockwise, CaretDown } from "@phosphor-icons/react";
import type { RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { useMinSpin } from "./useMinSpin";

const pill =
  "inline-flex h-[22px] cursor-pointer items-center rounded-md border border-(--tmd-border) bg-[color-mix(in_srgb,var(--tmd-bg-elevated)_86%,transparent)] px-1.5 text-(--tmd-fg-muted) backdrop-blur-[4px] hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)";

export function TerminalRefreshButton({ onClick }: { onClick: () => void }) {
  const { spinning, spin } = useMinSpin();
  return (
    <button
      type="button"
      data-icon-decor="terminal-refresh"
      aria-label={t("刷新幕布(重建本会话终端画面,PTY 不中断)")}
      title={t("刷新幕布(重建本会话终端画面,PTY 不中断)")}
      onClick={() => spin(onClick)}
      className={pill}
    >
      {spinning ? <Spinner size="0.75rem" /> : <ArrowClockwise size="0.75rem" />}
    </button>
  );
}

/**
 * 幕布回底钮 —— 深翻历史后一键贴底(纯视口操作,不动 PTY/缓冲)。深滚翻页
 * 场景(上翻数万行)逐条拖滚动条回底成本高;与「加载更早的输出」pill 是一对
 * 出口:上翻出 pill,回底钮收回。图标 pill 与刷新钮同形制,纯图标无文字。
 */
export function TerminalJumpToBottomButton({ termRef }: { termRef: RefObject<Terminal | null> }) {
  return (
    <button
      type="button"
      data-icon-decor="terminal-jump-bottom"
      aria-label={t("定位到底部")}
      title={t("定位到底部")}
      onClick={() => {
        termRef.current?.scrollToBottom();
        termRef.current?.focus();
      }}
      className={pill}
    >
      <CaretDown size="0.75rem" />
    </button>
  );
}
