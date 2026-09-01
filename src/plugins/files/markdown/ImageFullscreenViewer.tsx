/**
 * 图片全屏查看器 —— 照抄 codemoss ImageFullscreenViewer。
 *
 * viewerjs modal 模式不自动 show,必须显式 viewer.show()。
 * 主题切换经 MutationObserver(data-theme/data-theme-preset)触发 viewer.update()。
 * 与 codemoss 差异:无 workspaceId/panel-lock;本地路径经
 * ipc.readLocalImageDataUrl 转 dataURL,失败回退原始 src。
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
} from "./viewerRuntime";

const DIRECT_LOADABLE_PREFIX = /^(?:https?:|data:|blob:|asset:)/i;

/** viewerjs 可直接加载的 src 原样放行;本地路径走 Tauri 桥转 dataURL。 */
async function resolveImageViewerSrc(src: string): Promise<string> {
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

function isThemeMutationAttribute(attributeName: string | null): boolean {
  return attributeName === "data-theme" || attributeName === "data-theme-preset";
}

export function ImageFullscreenViewer({
  open,
  src,
  alt,
  onClose,
}: {
  open: boolean;
  src: string;
  alt?: string;
  onClose: () => void;
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

    let cancelled = false;
    let viewer: Viewer | null = null;
    let themeObserver: MutationObserver | null = null;

    (async () => {
      await preloadViewerStyles();
      if (cancelled) return;
      const { default: ViewerCtor } = await preloadViewerjs();
      if (cancelled || !imgRef.current) return;
      destroyActiveViewer();

      const finalSrc = await resolveImageViewerSrc(src);
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
          navbar: true,
          title: false,
          transition: !reducedMotion,
          backdrop: true,
          toolbar: {
            zoomIn: true,
            zoomOut: true,
            oneToOne: true,
            reset: true,
            rotateLeft: true,
            rotateRight: true,
            flipHorizontal: true,
            flipVertical: true,
            prev: true,
            next: true,
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
          if (isThemeMutationAttribute(mutation.attributeName)) {
            try {
              viewer?.update();
            } catch { /* ignore */ }
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
  }, [open, src, alt]);

  if (!open || !src || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <img
      ref={imgRef}
      className="viewer-image"
      src=""
      alt={alt ?? ""}
      aria-hidden="true"
    />,
    document.body,
  );
}
