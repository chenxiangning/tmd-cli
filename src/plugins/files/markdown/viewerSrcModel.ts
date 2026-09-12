/**
 * 全屏查看器的 src 解析 —— image 本地路径转 dataURL / Mermaid SVG 转 Base64
 * (自 FullscreenViewer.tsx 拆出,only-export-components):查看器组件留在原 tsx,
 * 本文件只留两个 src 解析入口与单槽缓存。
 */

import { ipc } from "@kernel/ipc";
import { svgToDataUrl } from "./viewerRuntime";

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
