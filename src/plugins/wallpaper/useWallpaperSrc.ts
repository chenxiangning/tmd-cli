/**
 * 壁纸图片 src 解析 hook —— asset:// 直读 + data URL 两级兜底。
 *
 * WKWebView 的 asset:// 不支持 Range 流播,但静态图片直读通常即可;
 * 失败(路径带特殊字符/平台限制)时回落 ipc.readLocalImageDataUrl
 * (Rust 侧白名单 + 大小闸),再失败交调用方标记 failed 撤层。
 * 视频 blob 兜底链是 v2 议题(v1 图片子集,见调研文档决策点 3)。
 */

import { useCallback, useRef, useState } from "react";
import { assetUrl, ipc } from "@kernel/ipc";

export type WallpaperSrc = {
  src: string;
  failed: boolean;
  handleError: () => void;
};

type SrcState = {
  path: string;
  src: string;
  failed: boolean;
};

function initialSrcState(path: string): SrcState {
  return { path, src: path ? assetUrl(path) : "", failed: false };
}

/** path 变化 = 新资产:渲染期直接重置(src 派生自 path,不挂 effect 同步)。 */
export function useWallpaperSrc(path: string): WallpaperSrc {
  const [state, setState] = useState<SrcState>(() => initialSrcState(path));
  if (state.path !== path) {
    setState(initialSrcState(path));
  }
  /* 恢复尝试记账(防 onError 风暴重复拉 data URL):path 变更自然作废。 */
  const recoverRef = useRef<{ path: string; done: boolean } | null>(null);

  const handleError = useCallback(() => {
    if (!path) {
      setState((cur) => (cur.path === path ? { ...cur, failed: true } : cur));
      return;
    }
    const record = recoverRef.current;
    /* 同 path 已恢复过仍报错 = data URL 也载入失败,终判 failed。 */
    if (record?.path === path && record.done) {
      setState((cur) => (cur.path === path ? { ...cur, failed: true } : cur));
      return;
    }
    if (record?.path === path) return;
    recoverRef.current = { path, done: false };
    void ipc
      .readLocalImageDataUrl(path)
      .then((dataUrl) => {
        recoverRef.current = { path, done: true };
        const ok = typeof dataUrl === "string" && dataUrl.startsWith("data:image/");
        setState((cur) =>
          cur.path === path ? { ...cur, src: ok ? dataUrl : cur.src, failed: !ok } : cur,
        );
      })
      .catch(() => {
        recoverRef.current = { path, done: true };
        setState((cur) => (cur.path === path ? { ...cur, failed: true } : cur));
      });
  }, [path]);

  return { src: state.src, failed: state.failed, handleError };
}
