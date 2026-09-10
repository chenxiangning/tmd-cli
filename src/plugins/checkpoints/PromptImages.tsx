/**
 * 用户消息图片件 —— 审批线详情(BatchSheet)消息卡的附件渲染。
 *
 * - extractPromptImages:附件 token 剥离纯函数,拆至 ./promptImagesExtract
 *   (only-export-components;时间线 timelineText 复用同一剥离);
 * - PromptImages:缩略图横排(96×72 cover),ipc.readLocalImageDataUrl 转
 *   data URL(Rust 白名单 + 20MB 闸);temp 已清理 → 置灰文件名 chip,不可点;
 * - 点击缩略图 → portal lightbox 放大查看(Esc/点背板关闭,复用缩略图已解析
 *   的 data URL,不二次读盘)。自写轻量查看器:不跨插件复用 files/markdown 的
 *   viewerjs(提升共享层超出本需求,见架构铁律)。
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Image, CircleNotch } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { ipc } from "@kernel/ipc";


/** 路径末段文件名(chip 与 lightbox caption 用)。 */
function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** 单张缩略图:加载中灰底 spinner;失败(文件已删/超闸)置灰 chip 不可点。 */
function Thumb({
  path,
  onOpen,
}: {
  path: string;
  onOpen: (src: string, name: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    ipc.readLocalImageDataUrl(path).then(
      (url) => {
        if (cancelled) return;
        if (url) setSrc(url);
        else setFailed(true);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (failed) {
    return (
      <span
        className="flex h-[72px] w-24 flex-none flex-col items-center justify-center gap-1 rounded border border-dashed border-(--tmd-border) px-1 text-(--tmd-fg-faint)"
        title={t("{path}(文件已不可读)", { path })}
      >
        <Image size="0.75rem" aria-hidden />
        <span className="w-full truncate text-center text-[0.625rem]">{fileName(path)}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={!src}
      className="flex h-[72px] w-24 flex-none items-center justify-center overflow-hidden rounded border border-(--tmd-border) bg-(--tmd-bg-elevated) hover:border-(--tmd-border-strong) disabled:cursor-default"
      title={t("{name} —— 点击放大查看", { name: fileName(path) })}
      onClick={() => src && onOpen(src, fileName(path))}
    >
      {src ? (
        <img src={src} alt={fileName(path)} className="h-full w-full object-cover" />
      ) : (
        <CircleNotch size="0.75rem" className="animate-spin text-(--tmd-fg-faint)" aria-hidden />
      )}
    </button>
  );
}

/** 放大查看:fixed 背板 + 适配视口原图;Esc/点背板关闭,点图不冒泡。 */
function Lightbox({
  src,
  name,
  onClose,
}: {
  src: string;
  name: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-1000 flex items-center justify-center bg-black/80"
      role="presentation"
      onClick={onClose}
    >
      <img
        src={src}
        alt={name}
        className="max-h-[92vh] max-w-[92vw] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="absolute bottom-4 left-4 max-w-[80vw] truncate rounded bg-black/60 px-2 py-1 font-mono text-[0.6875rem] text-white/80">
        {name}
      </div>
    </div>,
    document.body,
  );
}

/** 消息卡缩略图横排 + 放大查看状态。 */
export function PromptImages({ images }: { images: string[] }) {
  const [viewer, setViewer] = useState<{ src: string; name: string } | null>(null);
  if (images.length === 0) return null;
  return (
    <>
      <div className="mb-2 flex flex-wrap gap-2">
        {images.map((path) => (
          <Thumb
            key={path}
            path={path}
            onOpen={(src, name) => setViewer({ src, name })}
          />
        ))}
      </div>
      {viewer && (
        <Lightbox src={viewer.src} name={viewer.name} onClose={() => setViewer(null)} />
      )}
    </>
  );
}
