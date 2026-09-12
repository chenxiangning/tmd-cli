/**
 * 图片文件预览 —— 照抄 codemoss useFileImagePreview + FileViewBody image 分支。
 *
 * dataURL 优先(ipc.readLocalImageDataUrl,Rust 白名单+20MB 闸),失败回退
 * asset:// 直载(ipc.assetUrl)。信息行展示 尺寸 · 体积。
 * 与 codemoss 差异:体积不 fetch(imageSrc 是 data: 时 CSP connect-src 不放行,
 * 直接按 base64 长度推算;asset:// 回退时省略)。文案走 t() 词典。
 */

import { useCallback, useEffect, useState, type SyntheticEvent } from "react";
import { assetUrl, ipc } from "@kernel/ipc";
import { dataUrlByteLength } from "./previewBytes";
import { t } from "@kernel/i18n";

/* 与 composer/state/attachments.ts 的 formatBytes 是刻意不同的两份实现:
   本处紧凑无空格("1.5MB",图片信息条窄槽位);彼处带单位空格("1.5 KB",
   附件清单元数据)。输出契约不同,不合并。 */
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
  /* 换文件复位:渲染期 prev-path 对比直接调校 state,删掉 effect 复位
     (effect 方案在两次提交间会让用户看到一帧旧图的 stale 画面)。 */
  const [prevPath, setPrevPath] = useState(path);
  if (prevPath !== path) {
    setPrevPath(path);
    setImageSrc(null);
    setImageInfo(null);
    setImageLoadError(null);
  }

  useEffect(() => {
    let cancelled = false;

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
    setImageLoadError(t("图片加载失败"));
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
        <div className="fvp-status">{t("加载中…")}</div>
      )}
    </div>
  );
}
