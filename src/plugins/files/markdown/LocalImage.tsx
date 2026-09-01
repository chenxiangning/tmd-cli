/**
 * 本地图片组件 —— 照抄 codemoss LocalImage。
 *
 * 缓存每张图最终成功显示的源,重挂载时立即复用,
 * 避免「空白 → onError → 异步重取 dataURL」的视觉闪烁。
 * 上限 128 条 FIFO;同会话内磁盘图片不变,不追踪 mtime。
 * 与 codemoss 差异:无 workspaceId 维度,fallback 直接调 ipc.readLocalImageDataUrl。
 */

import { memo, useCallback, useEffect, useRef, useState, type ImgHTMLAttributes, type SyntheticEvent } from "react";
import { ipc } from "@kernel/ipc";

type LocalImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  localPath?: string | null;
};

const RESOLVED_IMAGE_CACHE_LIMIT = 128;
const resolvedImageCache = new Map<string, string>();

function localImageCacheKey(src: string, localPath?: string | null): string {
  return `${localPath ?? ""}::${src}`;
}

function rememberResolvedImage(key: string, resolved: string): void {
  if (resolvedImageCache.get(key) === resolved) {
    return;
  }
  resolvedImageCache.delete(key);
  resolvedImageCache.set(key, resolved);
  if (resolvedImageCache.size > RESOLVED_IMAGE_CACHE_LIMIT) {
    const oldestKey = resolvedImageCache.keys().next().value;
    if (oldestKey !== undefined) {
      resolvedImageCache.delete(oldestKey);
    }
  }
}

function resolveFallbackPath(src: string, localPath?: string | null): string | null {
  if (typeof localPath === "string" && localPath.trim()) {
    return localPath.trim();
  }
  const trimmed = src.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("file://")) {
    const withoutScheme = decodeURIComponent(trimmed.slice("file://".length));
    const hostlessPath = withoutScheme.startsWith("localhost/")
      ? withoutScheme.slice("localhost/".length)
      : withoutScheme;
    if (/^\/[A-Za-z]:[\\/]/.test(hostlessPath)) {
      return hostlessPath.slice(1);
    }
    if (/^[A-Za-z]:[\\/]/.test(hostlessPath)) {
      return hostlessPath;
    }
    return hostlessPath.startsWith("/") ? hostlessPath : `/${hostlessPath}`;
  }
  if (trimmed.startsWith("/")) {
    return trimmed;
  }
  if (/^[A-Za-z]:[\\/]/.test(trimmed) || /^\\\\[^\\]/.test(trimmed)) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "asset:") {
      const decodedPathname = decodeURIComponent(parsed.pathname ?? "");
      if (/^\/[A-Za-z]:[\\/]/.test(decodedPathname)) {
        return decodedPathname.slice(1);
      }
      return decodedPathname || null;
    }
  } catch {
    return null;
  }
  return null;
}

export const LocalImage = memo(function LocalImage({
  src,
  localPath,
  onError,
  onLoad,
  onClick,
  ...props
}: LocalImageProps) {
  const cacheKey = localImageCacheKey(src, localPath);
  const [resolvedSrc, setResolvedSrc] = useState(
    () => resolvedImageCache.get(cacheKey) ?? src,
  );
  const fallbackAttemptedRef = useRef(false);

  useEffect(() => {
    const cached = resolvedImageCache.get(cacheKey);
    if (cached) {
      setResolvedSrc(cached);
      fallbackAttemptedRef.current = true;
    } else {
      setResolvedSrc(src);
      fallbackAttemptedRef.current = false;
    }
  }, [cacheKey, src]);

  const handleError = useCallback(
    async (event: SyntheticEvent<HTMLImageElement, Event>) => {
      onError?.(event);
      if (fallbackAttemptedRef.current) {
        return;
      }
      const fallbackPath = resolveFallbackPath(resolvedSrc, localPath);
      if (!fallbackPath) {
        return;
      }
      fallbackAttemptedRef.current = true;
      try {
        const dataUrl = await ipc.readLocalImageDataUrl(fallbackPath);
        if (dataUrl) {
          rememberResolvedImage(cacheKey, dataUrl);
          setResolvedSrc(dataUrl);
        }
      } catch {
        // 桥失败:保留原 src,浏览器自行处理 broken 态。
      }
    },
    [cacheKey, localPath, onError, resolvedSrc],
  );

  const handleLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement, Event>) => {
      rememberResolvedImage(cacheKey, resolvedSrc);
      onLoad?.(event);
    },
    [cacheKey, onLoad, resolvedSrc],
  );

  return (
    <img
      decoding="async"
      {...props}
      src={resolvedSrc}
      onError={handleError}
      onLoad={handleLoad}
      onClick={onClick}
    />
  );
});
