/**
 * 全屏查看器 —— 原 Mermaid/ImageFullscreenViewer 双生子合并。
 * createPortal 到 document.body,逃出任何 overflow:hidden 祖先;
 * viewerjs modal 模式不自动 show,必须显式 viewer.show();
 * 主题切换经 MutationObserver(data-theme/data-theme-preset)触发 viewer.update()。
 * src 解析(image→dataURL / mermaid→Base64)拆至 viewerSrcModel.ts
 * (only-export-components)。差异点经 props 注入:
 * - resolveSrc:源串 → viewerjs 可加载 src
 * - navigation:true = image 变体(navbar/prev/next);false = mermaid 单图(zIndex 1300)
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type Viewer from "viewerjs";
import {
  destroyActiveViewer,
  getActiveViewer,
  preloadViewerStyles,
  preloadViewerjs,
  setActiveViewer,
} from "./viewerRuntime";

export function FullscreenViewer({
  open,
  src,
  alt,
  onClose,
  resolveSrc,
  navigation,
}: {
  open: boolean;
  src: string;
  alt?: string;
  onClose: () => void;
  /** 源串 → viewerjs 可加载 src(image 本地路径转 dataURL,mermaid SVG 转 Base64)。 */
  resolveSrc: (src: string) => Promise<string>;
  /** true = image 变体(navbar/prev/next);false = mermaid 单图(zIndex 1300)。 */
  navigation: boolean;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const onCloseRef = useRef(onClose);
  /* viewer 句柄随 ref 供主题观察器跨 effect 读取;viewerSeq 触发观察器随 viewer 重建。 */
  const viewerRef = useRef<Viewer | null>(null);
  const [viewerSeq, setViewerSeq] = useState(0);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  /* 主题切换 → viewer 重算配色(观察器独立 effect:同步创建同步清理,
     生命周期可追溯;原与 async 建 viewer 混在一个 effect 里,扫描器无法
     穿透 IIFE 追 cleanup)。观察器创建时机仍在 viewer.show() 之后,同旧版。 */
  useEffect(() => {
    if (!viewerSeq) return;
    const themeObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === "data-theme" || mutation.attributeName === "data-theme-preset") {
          try {
            viewerRef.current?.update();
          } catch { /* viewer 可能已销毁 */ }
          break;
        }
      }
    });
    themeObserver.observe(document.documentElement, { attributes: true });
    return () => themeObserver.disconnect();
  }, [viewerSeq]);

  useEffect(() => {
    if (!open || !src) {
      return;
    }
    void preloadViewerStyles();

    let cancelled = false;

    (async () => {
      await preloadViewerStyles();
      if (cancelled) return;
      const { default: ViewerCtor } = await preloadViewerjs();
      if (cancelled || !imgRef.current) return;

      // 先杀旧 viewer 再解析新 src(销毁时序与原 image 变体一致;mermaid resolve 同步,无差)
      destroyActiveViewer();

      const finalSrc = await resolveSrc(src);
      if (cancelled || !imgRef.current) return;
      if (!finalSrc) {
        onCloseRef.current();
        return;
      }
      imgRef.current.src = finalSrc;
      if (alt) imgRef.current.alt = alt;

      const reducedMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      try {
        viewerRef.current = new ViewerCtor(imgRef.current, {
          container: document.body,
          inline: false,
          title: false,
          transition: !reducedMotion,
          navbar: navigation,
          ...(navigation ? {} : { zIndex: 1300 }),
          toolbar: {
            zoomIn: true,
            zoomOut: true,
            oneToOne: true,
            reset: true,
            rotateLeft: true,
            rotateRight: true,
            flipHorizontal: true,
            flipVertical: true,
            prev: navigation,
            next: navigation,
            play: false,
          },
          shown() {
            if (cancelled) return;
            setActiveViewer(viewerRef.current);
            setViewerSeq((n) => n + 1);
          },
          hidden() {
            if (cancelled) return;
            onCloseRef.current();
          },
        });
      } catch {
        onCloseRef.current();
        return;
      }

      if (cancelled) {
        try {
          viewerRef.current.destroy();
        } catch { /* ignore */ }
        return;
      }
      viewerRef.current.show();
    })();

    return () => {
      cancelled = true;
      const viewer = viewerRef.current;
      if (viewer) {
        try {
          viewer.destroy();
        } catch { /* ignore */ }
      }
      viewerRef.current = null;
      if (getActiveViewer() === viewer) {
        setActiveViewer(null);
      }
    };
  }, [open, src, alt, resolveSrc, navigation]);

  if (!open || !src || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <img ref={imgRef} className="viewer-image" alt={alt ?? ""} aria-hidden="true" />,
    document.body,
  );
}
