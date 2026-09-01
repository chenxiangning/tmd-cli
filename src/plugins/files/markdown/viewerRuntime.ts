/**
 * viewerjs 运行时基础设施 —— 照抄 codemoss mermaidFullscreen/ 三件套合并。
 *
 * - preloadViewerjs:模块级 Promise 缓存,首次调用触发 dynamic import
 * - activeViewer 单例:同时只允许一个全屏 viewer 存活
 * - svgToDataUrl:Mermaid SVG → XML-safe Base64 data URL
 *   (inert template 规范化 foreignObject 的 HTML 序列化 → XMLSerializer 出合法 XML;
 *    Base64 而非 encodeURIComponent,因 mermaid v11 内联 <style> 含 <!-- 等字符;
 *    TextEncoder 先转 UTF-8 bytes 再过 btoa,保中文 label)
 */

import type Viewer from "viewerjs";

let viewerjsPromise: Promise<typeof import("viewerjs")> | null = null;

export function preloadViewerjs(): Promise<{ default: typeof Viewer }> {
  if (!viewerjsPromise) {
    // 有意 dynamic import:viewerjs 只在首次打开全屏查看器时加载(照抄 codemoss)
    viewerjsPromise = import("viewerjs");
  }
  return viewerjsPromise;
}

let viewerCssPromise: Promise<unknown> | null = null;

/** viewerjs 样式需在构造 viewer 前就绪(backdrop/toolbar 首帧布局)。 */
export function preloadViewerStyles(): Promise<unknown> {
  if (!viewerCssPromise) {
    // 有意 dynamic import:viewerjs 样式与 JS 同节奏懒加载
    viewerCssPromise = import("viewerjs/dist/viewer.css");
  }
  return viewerCssPromise;
}

let activeViewer: Viewer | null = null;

export function getActiveViewer(): Viewer | null {
  return activeViewer;
}

export function setActiveViewer(next: Viewer | null): void {
  activeViewer = next;
}

export function destroyActiveViewer(): void {
  if (activeViewer) {
    try {
      activeViewer.destroy();
    } catch {
      // viewer.destroy 在底层 DOM 已移除时会抛;忽略。
    }
    activeViewer = null;
  }
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function serializeSvgForImage(svg: string): string {
  if (typeof document === "undefined" || typeof XMLSerializer === "undefined") {
    return svg;
  }

  try {
    const template = document.createElement("template");
    template.innerHTML = svg.trim();
    const svgElement = template.content.firstElementChild;
    if (
      svgElement?.localName !== "svg" ||
      svgElement.namespaceURI !== SVG_NAMESPACE
    ) {
      return svg;
    }

    for (const element of svgElement.querySelectorAll("[xmlns]")) {
      if (element.getAttribute("xmlns") === element.namespaceURI) {
        element.removeAttribute("xmlns");
      }
    }
    return new XMLSerializer().serializeToString(svgElement);
  } catch {
    return svg;
  }
}

export function svgToDataUrl(svg: string): string {
  if (!svg) {
    return "";
  }
  const serializedSvg = serializeSvgForImage(svg);
  const utf8Bytes = new TextEncoder().encode(serializedSvg);
  let binary = "";
  for (let i = 0; i < utf8Bytes.length; i += 1) {
    binary += String.fromCharCode(utf8Bytes[i]);
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}
