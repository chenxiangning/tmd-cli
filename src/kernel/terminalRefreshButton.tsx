/**
 * 幕布刷新钮 —— 单会话幕布重建的手动出口(受控组件,重建由 TerminalView
 * 的 canvasGen 代数驱动:xterm 销毁重建 + 输出缓冲回放 + 强制 SIGWINCH
 * 整帧重绘,PTY/CLI 全程不中断)。
 *
 * 定位与外观:幕布右上工具行(TerminalView 行容器,right 12/top 8)最右一枚,
 * 与插件经 terminal.canvasRow 挂点贡献的工具钮(结构化视图切换)同排同款
 * pill 形制(22px 高/10px 内距/6px 圆角/半透明 elevated 底 + 4px 毛玻璃);
 * 定位归行容器,本件零锚定。与整页 reload 的分工:这里是会话内自救(幕布
 * 错乱/内容滞留);WebKit 级像素冻结由守望阶梯自动自愈(render_health),不经此钮。
 */
import { ArrowClockwise } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";

export function TerminalRefreshButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      title={t("刷新幕布(重建本会话终端画面,PTY 不中断)")}
      onClick={onClick}
      className="inline-flex h-[22px] cursor-pointer items-center gap-1 rounded-md border border-(--tmd-border) bg-[color-mix(in_srgb,var(--tmd-bg-elevated)_86%,transparent)] px-2.5 text-[0.6875rem] text-(--tmd-fg-muted) backdrop-blur-[4px] hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
    >
      {/* 高频自救钮给图标 affordance:与低频「结构化视图」纯文字钮分主次 */}
      <ArrowClockwise size="0.75rem" />
      {t("刷新")}
    </button>
  );
}
