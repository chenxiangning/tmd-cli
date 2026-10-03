/**
 * 会话屏周边件 —— 自 SessionScreen 拆出守 300 行铁则:
 * SessionHeader(顶栏)/ ShotPreview(全屏看图,点击关闭)。
 * 旧 ShotStrip/SendErrBars 已随三态胶囊重做迁 Composer.tsx
 * (spec 2026-10-03-mobile-composer-redesign)。
 */
import { useEffect, useRef } from "react";
import { t } from "@kernel/i18n";
import { EngineMark } from "./EngineMark";
import { HostChip } from "./ConnChip";

/** 会话顶栏:返回/引擎/标题/审批线 chip/横竖屏切换/通道(纯展示,状态在父组件)。 */
export function SessionHeader(props: {
  title: string;
  profileId: string;
  ckpt: { pending: number; approved: number } | null;
  landscape: boolean;
  onBack: () => void;
  onCkpt: () => void;
  onOrient: () => void;
}) {
  return (
    <div className="nav">
      <button type="button" className="back" aria-label={t("返回列表")} onClick={props.onBack}>
        ‹
      </button>
      <EngineMark profileId={props.profileId} />
      <span className="t">{props.title}</span>
      {props.ckpt && (
        <button
          type="button"
          className={`nav-chip${props.ckpt.pending > 0 ? " warn" : ""}`}
          aria-label={t("审批线")}
          onClick={props.onCkpt}
        >
          {t("审批")}
          {props.ckpt.pending > 0 ? ` ${props.ckpt.pending}` : ""}
        </button>
      )}
      <button type="button" className="orient-btn" aria-label={t("切换横竖屏")} onClick={props.onOrient}>
        {props.landscape ? t("竖屏") : t("横屏")}
      </button>
      <HostChip />
    </div>
  );
}

/** 全屏看图浮层(点缩略图开;点任意处/Esc/Enter 关 —— 监听挂 document/window,
 *  JSX 零 onClick,触屏点图即关与键盘同权)。 */
export function ShotPreview(props: { url: string | null; onClose: () => void }) {
  const url = props.url;
  /* onClose 经 ref(渲染期只读不改写):监听只随 url 拆挂,父级重渲染不重置 armed */
  const closeRef = useRef(props.onClose);
  useEffect(() => {
    closeRef.current = props.onClose;
  });
  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") closeRef.current();
    };
    /* defer 一拍:开浮层的那个 click 冒泡到 document 前先待命,不吞当次 */
    let armed = false;
    window.setTimeout(() => {
      armed = true;
    }, 0);
    const guarded = () => {
      if (armed) closeRef.current();
    };
    document.addEventListener("click", guarded);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", guarded);
      window.removeEventListener("keydown", onKey);
    };
  }, [url]);
  if (!url) return null;
  return (
    <dialog open className="shot-preview" aria-label={t("图片预览")}>
      <img src={url} alt="" />
    </dialog>
  );
}
