/**
 * 会话屏周边件 —— 自 SessionScreen 拆出守 300 行铁则:
 * SessionHeader(顶栏)/ ShotStrip(挂图缩略行)/ SendErrBars(悬浮错误条:
 * 发送失败可重试、选图失败给人话;浮在 composer 上缘不挤布局)/
 * ShotPreview(全屏看图,点击关闭)。
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

/** 选图预览缩略图行(空态返 null;移除按 path 定位,objectURL 释放归 useShots;
 *  点缩略图全屏看图——此前缩略图点不开,误挂大图只能删了重选)。 */
export function ShotStrip(props: {
  shots: { path: string; url: string }[];
  onRemove: (path: string) => void;
  onPreview: (url: string) => void;
}) {
  if (!props.shots.length) return null;
  return (
    <div className="shots">
      {props.shots.map((s) => (
        <div className="shot" key={s.path}>
          <button type="button" className="shot-img-btn" aria-label={t("查看大图")} onClick={() => props.onPreview(s.url)}>
            <img src={s.url} alt="" />
          </button>
          <button type="button" className="shot-x" aria-label={t("移除图片")} onClick={() => props.onRemove(s.path)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/** 悬浮错误条组(浮在 composer 上缘,不挤压布局;继续输入即清发送错)。 */
export function SendErrBars(props: { sendErr: boolean; shotErr: boolean; onRetry: () => void }) {
  if (!props.sendErr && !props.shotErr) return null;
  return (
    <div className="m-errs">
      {props.sendErr ? (
        <div className="m-err-bar" role="alert">
          <span>{t("发送失败,消息已保留")}</span>
          <button type="button" onClick={props.onRetry}>{t("重试")}</button>
        </div>
      ) : null}
      {props.shotErr ? (
        <div className="m-err-bar" role="alert">
          <span>{t("选图失败,请重试")}</span>
        </div>
      ) : null}
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
