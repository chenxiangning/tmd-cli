import type { NonDeleted, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { IntentCanvasScene } from "../types";

export const THUMBNAIL_MAX_ELEMENTS = 80;
export const THUMBNAIL_MAX_CHARS = 8 * 1024;

/**
 * 生成列表卡片用的静态 SVG 缩略图。
 * 预算：≤80 个非删除元素、不内联图片 files、序列化 ≤8KB；超预算或失败返回 null（丢缩略图，不影响保存）。
 */
export async function buildIntentCanvasThumbnailSvg(
  scene: IntentCanvasScene,
): Promise<string | null> {
  const elements = scene.elements
    .filter((element) => !element.isDeleted)
    .slice(0, THUMBNAIL_MAX_ELEMENTS);
  if (elements.length === 0) {
    return null;
  }
  try {
    // 动态引入，避免把 Excalidraw 打进 manager 首屏 chunk。
    const { exportToSvg } = /* 动态 import 为代码分割:excalidraw 导出器 MB 级,只在生成缩略图时加载;非运行时选路。 */
  await import("@excalidraw/excalidraw");
    const svg = await exportToSvg({
      elements: elements as readonly NonDeleted<ExcalidrawElement>[],
      appState: {
        ...scene.appState,
        exportBackground: false,
        exportWithDarkMode: false,
      },
      files: null,
      skipInliningFonts: true,
    });
    // 列表缩略图规格：由 CSS 控制尺寸，居中裁切。
    svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    const markup = svg.outerHTML;
    return markup.length <= THUMBNAIL_MAX_CHARS ? markup : null;
  } catch {
    // 缩略图是尽力而为的派生缓存：生成失败仅回退占位图形。
    return null;
  }
}
