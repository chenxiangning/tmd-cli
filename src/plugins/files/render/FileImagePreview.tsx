/**
 * 图片文件预览 —— 照抄 codemoss useFileImagePreview + FileViewBody image 分支。
 *
 * dataURL 优先(ipc.readLocalImageDataUrl,Rust 白名单+20MB 闸),失败回退
 * asset:// 直载(ipc.assetUrl)。信息行展示 尺寸 · 体积。
 * 与 codemoss 差异:体积不 fetch(imageSrc 是 data: 时 CSP connect-src 不放行,
 * 直接按 base64 长度推算;asset:// 回退时省略)。i18n 硬编码中文。
 */

import { useCallback, useEffect, useState, type SyntheticEvent } from "react";
import { assetUrl, ipc } from "@kernel/ipc";
import { dataUrlByteLength } from "./previewBytes";

function formatBytes(sizeBytes: number): string {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  if (sizeBytes >= 1024) {
    return `${(sizeBytes / 1024).toFixed(1)}KB`;
  }
  return `${sizeBytes}B`;
}

type ImageInfo = {
  width: number;
  height: number;
  sizeBytes: number | null;
};

export function FileImagePreview({ path }: { path: string }) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageLoadError, setImageLoadError] = useState<string | null>(null);
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    setImageSrc(null);
    setImageInfo(null);
    setImageLoadError(null);

    ipc.readLocalImageDataUrl(path).then(
      (dataUrl) => {
        if (cancelled) return;
        setImageSrc(dataUrl || assetUrl(path));
      },
      () => {
        if (cancelled) return;
        setImageSrc(assetUrl(path));
      },
    );

    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    setImageInfo(null);
    if (!imageSrc) return;
    const sizeBytes = dataUrlByteLength(imageSrc);
    if (sizeBytes != null) {
      setImageInfo({ width: 0, height: 0, sizeBytes });
    }
  }, [imageSrc]);

  const handleImageLoad = useCallback((e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageLoadError(null);
    setImageInfo((prev) => ({
      width: img.naturalWidth,
      height: img.naturalHeight,
      sizeBytes: prev?.sizeBytes ?? null,
    }));
  }, []);

  const handleImageError = useCallback(() => {
    setImageInfo(null);
    setImageLoadError("图片加载失败");
  }, []);

  return (
    <div className="fvp-image-preview">
      {imageSrc ? (
        <div className="fvp-image-preview-inner">
          <img
            src={imageSrc}
            alt={path}
            className="fvp-image-preview-img"
            draggable={false}
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
          {imageLoadError ? (
            <span className="fvp-image-info fvp-error">{imageLoadError}</span>
          ) : imageInfo ? (
            <span className="fvp-image-info">
              {imageInfo.width > 0 && `${imageInfo.width} × ${imageInfo.height}`}
              {imageInfo.width > 0 && imageInfo.sizeBytes != null && " · "}
              {imageInfo.sizeBytes != null && formatBytes(imageInfo.sizeBytes)}
            </span>
          ) : null}
        </div>
      ) : imageLoadError ? (
        <span className="fvp-image-info fvp-error">{imageLoadError}</span>
      ) : (
        <div className="fvp-status">加载中…</div>
      )}
    </div>
  );
}
