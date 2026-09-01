/**
 * Mermaid 全屏查看器 —— 照抄 codemoss MermaidFullscreenViewer。
 *
 * createPortal 到 document.body,逃出任何 overflow:hidden 祖先。
 * SVG 经 svgToDataUrl 转 Base64 后喂给 viewerjs 的 <img>。
 * 与 codemoss 差异:裁掉 PNG 下载按钮(需 Rust 写盘命令)与 panel-lock 联动。
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type Viewer from "viewerjs";
import {
  destroyActiveViewer,
  getActiveViewer,
  preloadViewerStyles,
  preloadViewerjs,
  setActiveViewer,
  svgToDataUrl,
} from "./viewerRuntime";

function isThemeMutationAttribute(attributeName: string | null): boolean {
  return attributeName === "data-theme" || attributeName === "data-theme-preset";
}

export function MermaidFullscreenViewer({
  open,
  svg,
  onClose,
}: {
  open: boolean;
  svg: string;
  onClose: () => void;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const onCloseRef = useRef(onClose);
  const imageSourceCacheRef = useRef<{ svg: string; dataUrl: string } | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || !svg) {
      return;
    }
    void preloadViewerStyles();

    let cancelled = false;
    let viewer: Viewer | null = null;
    let themeObserver: MutationObserver | null = null;

    (async () => {
      await preloadViewerStyles();
      const { default: ViewerCtor } = await preloadViewerjs();
      if (cancelled || !imgRef.current) return;
      const imageElement = imgRef.current;
      const cachedSource = imageSourceCacheRef.current;
      const dataUrl =
        cachedSource?.svg === svg ? cachedSource.dataUrl : svgToDataUrl(svg);
      if (cachedSource?.svg !== svg) {
        imageSourceCacheRef.current = { svg, dataUrl };
      }
      imageElement.src = dataUrl;

      destroyActiveViewer();

      const reducedMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      viewer = new ViewerCtor(imageElement, {
        container: document.body,
        inline: false,
        zIndex: 1300,
        navbar: false,
        title: false,
        transition: !reducedMotion,
        toolbar: {
          zoomIn: true,
          zoomOut: true,
          oneToOne: true,
          reset: true,
          rotateLeft: true,
          rotateRight: true,
          flipHorizontal: true,
          flipVertical: true,
          prev: false,
          next: false,
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
      if (cancelled) {
        try {
          viewer.destroy();
        } catch { /* ignore */ }
        return;
      }
      viewer.show();

      themeObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (isThemeMutationAttribute(mutation.attributeName)) {
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
  }, [open, svg]);

  if (!open || !svg || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <img ref={imgRef} alt="" aria-hidden="true" />,
    document.body,
  );
}
