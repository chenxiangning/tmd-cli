/**
 * Spinner —— 全仓唯一忙态形制(2026-10-02 设计系统收口):
 * span[role=status] 包 Phosphor CircleNotch,经全局 tmdSpin keyframes
 * (src/styles/global.css)以 1s linear infinite 旋转(内联 style 引用,
 * 减动效由全局 prefers-reduced-motion 规则接管停帧)。
 * 九点阵 lv-spin / ss-spin 属既存豁免;新代码的加载指示一律用它,
 * 不再自抄 animate-spin 副本。aria-label 走 t("加载中")(词条已收 ssh 域)。
 */
import { CircleNotch } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";

export function Spinner({
  size = "0.75rem",
  className,
}: {
  /** 图标尺寸(CSS 长度串,透传 Phosphor size;默认 12px 正文行内档)。 */
  size?: string;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label={t("加载中")}
      className={"inline-flex items-center" + (className ? ` ${className}` : "")}
    >
      <CircleNotch
        aria-hidden
        size={size}
        style={{ animation: "tmdSpin 1s linear infinite" }}
      />
    </span>
  );
}
