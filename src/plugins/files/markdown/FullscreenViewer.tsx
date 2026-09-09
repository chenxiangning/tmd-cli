/**
 * 全屏查看器 —— 原 Mermaid/ImageFullscreenViewer 双生子合并。
 *
 * createPortal 到 document.body,逃出任何 overflow:hidden 祖先;
 * viewerjs modal 模式不自动 show,必须显式 viewer.show();
 * 主题切换经 MutationObserver(data-theme/data-theme-preset)触发 viewer.update()。
 * 差异点经 props 注入:
 * - resolveSrc:源串 → viewerjs 可加载 src
 * - navigation:true = image 变体(navbar/prev/next);false = mermaid 单图(zIndex 1300)
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type Viewer from "viewerjs";
import { ipc } from "@kernel/ipc";
import {
  destroyActiveViewer,
  getActiveViewer,
  preloadViewerStyles,
  preloadViewerjs,
  setActiveViewer,
  svgToDataUrl,
} from "./viewerRuntime";

const DIRECT_LOADABLE_PREFIX = /^(?:https?:|data:|blob:|asset:)/i;

/** viewerjs 可直接加载的 src 原样放行;本地路径走 Tauri 桥转 dataURL,失败回退原始 src。 */
export async function resolveImageViewerSrc(src: string): Promise<string> {
  if (!src || DIRECT_LOADABLE_PREFIX.test(src)) {
    return src;
  }
  try {
    const dataUrl = await ipc.readLocalImageDataUrl(src);
    return dataUrl || src;
  } catch {
    return src;
  }
}

// 单槽缓存即可:同时只有一个全屏 viewer 存活,跨块切换重算一次 btoa 可忽略
let mermaidSourceCache: { svg: string; dataUrl: string } | null = null;

/** Mermaid SVG → XML-safe Base64 data URL(缓存最近一次转换)。 */
export function resolveMermaidViewerSrc(svg: string): Promise<string> {
  if (mermaidSourceCache?.svg !== svg) {
    mermaidSourceCache = { svg, dataUrl: svgToDataUrl(svg) };
  }
  return Promise.resolve(mermaidSourceCache.dataUrl);
}


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

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || !src) {
      return;
    }
    void preloadViewerStyles();

    let cancelled = false;
    let viewer: Viewer | null = null;
    let themeObserver: MutationObserver | null = null;

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
        viewer = new ViewerCtor(imgRef.current, {
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
            setActiveViewer(viewer);
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
          viewer.destroy();
        } catch { /* ignore */ }
        return;
      }
      viewer.show();

      themeObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.attributeName === "data-theme" || mutation.attributeName === "data-theme-preset") {
            try {
              viewer?.update();
            } catch { /* viewer 可能已销毁 */ }
            break;
          }
        }
      });
      themeObserver.observe(document.documentElement, { attributes: true });
    })();

    return () => {
      cancelled = true;
      themeObserver?.disconnect();
      if (viewer) {
        try {
          viewer.destroy();
        } catch { /* ignore */ }
      }
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
