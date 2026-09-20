/**
 * 回到顶部浮动按钮 —— 对齐 yn DefaultPreviewer.vue .scroll-to-top。
 * 预览滚动 >= 30px 淡入;点击平滑滚回顶部。三角形箭头走 CSS ::before。
 */

import { useEffect, useState, type RefObject } from "react";
import { t } from "@kernel/i18n";

const SHOW_THRESHOLD_PX = 30;

export function BackToTopButton({
  scrollRef,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) {
      return;
    }
    const syncVisible = () => setVisible(scrollEl.scrollTop >= SHOW_THRESHOLD_PX);
    syncVisible();
    scrollEl.addEventListener("scroll", syncVisible, { passive: true });
    return () => scrollEl.removeEventListener("scroll", syncVisible);
  }, [scrollRef]);

  return (
    <button
      type="button"
      className={`fvp-preview-back-top${visible ? "" : " is-hidden"}`}
      aria-label={t("回到顶部")}
      title={t("回到顶部")}
      onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
    >
      TOP
    </button>
  );
}
