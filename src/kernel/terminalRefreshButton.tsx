/**
 * 幕布保底刷新钮 —— 渲染粘死的手动自救出口(每张幕布右上角常驻)。
 *
 * 为什么存在:WKWebView 吊销粘死时像素停在旧帧,但 JS 事件循环与 ≥500ms
 * 定时器常活着(症状链见 rafFallback.ts)——按钮点击仍能派发。会话/PTY
 * 注册表跨 webview 重载存活(sessionAdopt),location.reload() 与守望二击
 * 同语义:重放输出缓冲 + 续接实时流,CLI 不中断。守望自动阶梯之外留一个
 * 不依赖看门狗节拍的手动出口——尤其洪水期自动 reload 被降级为 focus
 * (floodGauge 判据,退洪才真愈),分钟级空窗里用户可立即自救。
 * 击发即钉死:粘死态像素无反馈,连点不得叠发 reload。
 */
import { useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";

export function TerminalRefreshButton() {
  const [kicked, setKicked] = useState(false);
  return (
    <button
      type="button"
      title={t("刷新界面(渲染卡死自救,会话不中断)")}
      disabled={kicked}
      onClick={() => {
        if (kicked) return;
        setKicked(true);
        window.location.reload();
      }}
      className="absolute right-2 top-2 z-20 flex size-6 items-center justify-center rounded-md border border-(--tmd-border) bg-(--tmd-bg-popover) text-(--tmd-fg-muted) opacity-60 transition-opacity hover:bg-(--tmd-bg-hover) hover:opacity-100"
    >
      <ArrowClockwise className="size-3.5" />
    </button>
  );
}
