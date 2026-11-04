/**
 * 长消息折叠 —— 移植 codemoss CollapsibleMessage 交互律(2026-11-05 幕布重构
 * 批次2):内容高于 480px 提供折叠,收起态 320px + 底部渐隐 + 中央 chevron;
 * 测量走 clamped 盒的 scrollHeight(晚到图片可重判)。经 TranscriptView 的
 * WrapLong 可选 prop 注入,仅 structured-session 路径生效,PTY 会话查看器
 * 零影响。
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";

/** 高于此值才提供折叠(codemoss COLLAPSE_THRESHOLD_PX)。 */
const COLLAPSE_THRESHOLD_PX = 480;
/** 收起态钳制高度(codemoss COLLAPSED_HEIGHT_PX)。 */
const COLLAPSED_HEIGHT_PX = 320;

export function SsCollapsible({ children }: { children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [collapsible, setCollapsible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fullHeight, setFullHeight] = useState(0);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    /* scrollHeight 在钳制态仍报完整内容高;首渲染 instant collapse,
     * 用户手切才用 max-height 过渡(CSS 只给 is-anim 加 transition)。 */
    const full = el.scrollHeight;
    setFullHeight(full);
    setCollapsible(full > COLLAPSE_THRESHOLD_PX);
  }, [children]);

  const clamped = collapsible && !expanded;
  return (
    <div className="ss-collapsible">
      <div
        ref={contentRef}
        className={`ss-collapsible-box${clamped ? " is-clamped is-anim" : " is-anim"}`}
        style={clamped ? { maxHeight: COLLAPSED_HEIGHT_PX } : { maxHeight: fullHeight || undefined }}
      >
        {children}
      </div>
      {collapsible ? (
        <button
          type="button"
          className="ss-collapsible-toggle"
          aria-expanded={expanded}
          aria-label={expanded ? t("收起") : t("展开全文")}
          title={expanded ? t("收起") : t("展开全文")}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <CaretUp size="0.75rem" /> : <CaretDown size="0.75rem" />}
        </button>
      ) : null}
      {clamped ? <div className="ss-collapsible-fade" aria-hidden /> : null}
    </div>
  );
}
