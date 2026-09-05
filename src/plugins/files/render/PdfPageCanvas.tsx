/**
 * PDF 单页画布 —— 自 FilePdfPreview.tsx 拆出(文件规模铁则)。
 *
 * 单页 canvas 渲染:IntersectionObserver 视口外懒渲染(rootMargin 240px)、
 * devicePixelRatio 缩放,组件销毁时 cancel RenderTask 并 cleanup 页面对象。
 */

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

type PdfPageCanvasProps = {
  pdfDocument: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
};

export function PdfPageCanvas({ pdfDocument, pageNumber, scale }: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageRootRef = useRef<HTMLDivElement | null>(null);
  const [shouldRender, setShouldRender] = useState(pageNumber <= 2);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    const node = pageRootRef.current;
    if (!node || shouldRender || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldRender(true);
      }
    }, { rootMargin: "240px 0px" });

    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldRender]);

  useEffect(() => {
    if (!shouldRender || !canvasRef.current) {
      return;
    }

    let disposed = false;
    let renderTask: RenderTask | null = null;
    setPageError(null);

    void (async () => {
      try {
        const page = await pdfDocument.getPage(pageNumber);
        if (disposed || !canvasRef.current) {
          return;
        }
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Canvas 上下文不可用");
        }
        const devicePixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * devicePixelRatio);
        canvas.height = Math.floor(viewport.height * devicePixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
        });
        await renderTask.promise;
        if (!disposed) {
          page.cleanup();
        }
      } catch (error) {
        if (!disposed) {
          setPageError(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      disposed = true;
      renderTask?.cancel();
    };
  }, [pageNumber, pdfDocument, scale, shouldRender]);

  return (
    <div ref={pageRootRef} className="fvp-pdf-page" data-page-number={pageNumber}>
      <header className="fvp-pdf-page-header">
        <span>{`第 ${pageNumber} 页`}</span>
      </header>
      {pageError ? (
        <div className="fvp-pdf-page-error">{pageError}</div>
      ) : shouldRender ? (
        <canvas ref={canvasRef} className="fvp-pdf-canvas" />
      ) : (
        <div className="fvp-pdf-page-placeholder">滚动到此处渲染</div>
      )}
    </div>
  );
}
