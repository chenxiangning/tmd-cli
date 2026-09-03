/**
 * PDF 文件预览 —— 照抄 codemoss FilePdfPreview.tsx。
 *
 * pdf.js 逐页 canvas 渲染:IntersectionObserver 视口外懒渲染(rootMargin 240px)、
 * devicePixelRatio 缩放、页窗口上限 200 页、缩放 0.75-3(步进 0.1)、
 * 文档 outline 侧栏(点击跳页并平移页窗口)。
 * 与 codemoss 差异:数据源从 asset:// fetch 改为 readBinaryFileBase64 字节通道
 * (getDocument({ data })),免 asset 作用域问题;i18n 硬编码中文。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { getDocument, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import { ensurePdfPreviewWorker } from "./pdfRuntime";
import { loadPreviewBytes } from "./previewBytes";
import {
  extractPdfPreviewOutline,
  type PreviewOutlineItem,
} from "./previewOutline";
import { PreviewOutlineSidebar } from "../markdown/PreviewOutlineSidebar";

const MAX_PDF_PREVIEW_PAGES = 200;
const PDF_PAGE_WINDOW_OFFSET = 5;
const DEFAULT_PDF_SCALE = 1.15;
const MIN_PDF_SCALE = 0.75;
const MAX_PDF_SCALE = 3;
const PDF_SCALE_STEP = 0.1;

type PdfPageCanvasProps = {
  pdfDocument: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
};

function PdfPageCanvas({ pdfDocument, pageNumber, scale }: PdfPageCanvasProps) {
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

type FilePdfPreviewProps = {
  path: string;
};

export function FilePdfPreview({ path }: FilePdfPreviewProps) {
  const previewRootRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollPageNumberRef = useRef<number | null>(null);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [isRuntimeLoading, setIsRuntimeLoading] = useState(false);
  const [outlineItems, setOutlineItems] = useState<PreviewOutlineItem[]>([]);
  const [activeOutlineItemId, setActiveOutlineItemId] = useState<string | null>(null);
  const [pageWindowStart, setPageWindowStart] = useState(1);
  const [isOutlineCollapsed, setIsOutlineCollapsed] = useState(false);
  const [pdfScale, setPdfScale] = useState(DEFAULT_PDF_SCALE);

  useEffect(() => {
    setPdfDocument(null);
    setNumPages(0);
    setRuntimeError(null);
    setIsRuntimeLoading(true);
    setOutlineItems([]);
    setActiveOutlineItemId(null);
    setPageWindowStart(1);
    setIsOutlineCollapsed(false);
    setPdfScale(DEFAULT_PDF_SCALE);

    let disposed = false;
    let loadedDocument: PDFDocumentProxy | null = null;

    void (async () => {
      try {
        ensurePdfPreviewWorker();
        const bytes = await loadPreviewBytes(path);
        const loadingTask = getDocument({ data: bytes.slice() });
        const nextDocument = await loadingTask.promise;
        loadedDocument = nextDocument;
        if (disposed) {
          await nextDocument.destroy();
          return;
        }
        setPdfDocument(nextDocument);
        setNumPages(nextDocument.numPages);
        setRuntimeError(null);
        setIsRuntimeLoading(false);
      } catch (loadError) {
        if (disposed) return;
        setPdfDocument(null);
        setNumPages(0);
        setRuntimeError(loadError instanceof Error ? loadError.message : String(loadError));
        setIsRuntimeLoading(false);
      }
    })();

    return () => {
      disposed = true;
      if (loadedDocument) {
        void loadedDocument.destroy();
      }
    };
  }, [path]);

  useEffect(() => {
    if (!pdfDocument) {
      setOutlineItems([]);
      setActiveOutlineItemId(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const nextOutlineItems = await extractPdfPreviewOutline(pdfDocument, "未命名");
        if (!cancelled) {
          setOutlineItems(nextOutlineItems);
        }
      } catch {
        if (!cancelled) {
          setOutlineItems([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfDocument]);

  const maxPageWindowStart = Math.max(1, numPages - MAX_PDF_PREVIEW_PAGES + 1);
  const normalizedPageWindowStart = Math.min(pageWindowStart, maxPageWindowStart);
  const visiblePageCount = Math.min(
    MAX_PDF_PREVIEW_PAGES,
    Math.max(0, numPages - normalizedPageWindowStart + 1),
  );
  const isPageCountTruncated = numPages > MAX_PDF_PREVIEW_PAGES;
  const visiblePageNumbers = useMemo(
    () => Array.from({ length: visiblePageCount }, (_, index) => normalizedPageWindowStart + index),
    [normalizedPageWindowStart, visiblePageCount],
  );

  const scrollToRenderedPage = (pageNumber: number) => {
    const pageNode = previewRootRef.current?.querySelector<HTMLElement>(
      `[data-page-number="${pageNumber}"]`,
    );
    pageNode?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const handleSelectOutlineItem = (item: PreviewOutlineItem) => {
    if (item.target.kind !== "pdf-page") {
      return;
    }
    const nextPageNumber = item.target.pageNumber;
    if (!Number.isInteger(nextPageNumber) || nextPageNumber < 1 || nextPageNumber > numPages) {
      return;
    }
    const nextWindowStart = Math.min(
      Math.max(nextPageNumber - PDF_PAGE_WINDOW_OFFSET, 1),
      maxPageWindowStart,
    );

    setActiveOutlineItemId(item.id);
    pendingScrollPageNumberRef.current = nextPageNumber;
    setPageWindowStart(nextWindowStart);

    if (
      nextWindowStart === normalizedPageWindowStart &&
      nextPageNumber >= normalizedPageWindowStart &&
      nextPageNumber < normalizedPageWindowStart + visiblePageCount
    ) {
      scrollToRenderedPage(nextPageNumber);
      pendingScrollPageNumberRef.current = null;
    }
  };

  useEffect(() => {
    const pendingPageNumber = pendingScrollPageNumberRef.current;
    if (!pendingPageNumber) {
      return;
    }
    scrollToRenderedPage(pendingPageNumber);
    pendingScrollPageNumberRef.current = null;
  }, [visiblePageNumbers]);

  if (isRuntimeLoading) {
    return <div className="fvp-status">加载中…</div>;
  }

  if (runtimeError) {
    return <div className="fvp-status fvp-error">{runtimeError}</div>;
  }

  if (!pdfDocument) {
    return <div className="fvp-status">无法加载 PDF 预览</div>;
  }

  return (
    <div className="fvp-preview-scroll">
      <div className={`fvp-preview-shell${isOutlineCollapsed ? " is-outline-collapsed" : ""}`}>
        {!isOutlineCollapsed ? (
          <PreviewOutlineSidebar
            items={outlineItems}
            activeItemId={activeOutlineItemId}
            onSelectItem={handleSelectOutlineItem}
          />
        ) : null}
        <div ref={previewRootRef} className="fvp-pdf-preview fvp-preview-main">
          <header className="fvp-preview-section-header">
            <div className="fvp-preview-section-title">
              <strong>PDF 预览</strong>
              <span>{`共 ${numPages} 页`}</span>
            </div>
            <div className="fvp-preview-toolbar" role="toolbar" aria-label="PDF 缩放工具栏">
              {outlineItems.length > 0 ? (
                <button
                  type="button"
                  className="fvp-preview-toolbar-button"
                  onClick={() => setIsOutlineCollapsed((current) => !current)}
                >
                  {isOutlineCollapsed ? "展开目录" : "收起目录"}
                </button>
              ) : null}
              <button
                type="button"
                className="fvp-preview-toolbar-button"
                aria-label="缩小"
                disabled={pdfScale <= MIN_PDF_SCALE}
                onClick={() =>
                  setPdfScale((current) =>
                    Math.max(MIN_PDF_SCALE, Math.round((current - PDF_SCALE_STEP) * 100) / 100),
                  )
                }
              >
                -
              </button>
              <button
                type="button"
                className="fvp-preview-toolbar-button fvp-preview-toolbar-value"
                aria-label="重置缩放"
                onClick={() => setPdfScale(DEFAULT_PDF_SCALE)}
              >
                {`${Math.round(pdfScale * 100)}%`}
              </button>
              <button
                type="button"
                className="fvp-preview-toolbar-button"
                aria-label="放大"
                disabled={pdfScale >= MAX_PDF_SCALE}
                onClick={() =>
                  setPdfScale((current) =>
                    Math.min(MAX_PDF_SCALE, Math.round((current + PDF_SCALE_STEP) * 100) / 100),
                  )
                }
              >
                +
              </button>
            </div>
          </header>
          {isPageCountTruncated ? (
            <div className="fvp-preview-budget-hint">
              {`文档共 ${numPages} 页,当前展示第 ${normalizedPageWindowStart} 页起的 ${visiblePageCount} 页`}
            </div>
          ) : null}
          <div className="fvp-pdf-pages">
            {visiblePageNumbers.map((pageNumber) => (
              <PdfPageCanvas
                key={`pdf-page-${pageNumber}`}
                pdfDocument={pdfDocument}
                pageNumber={pageNumber}
                scale={pdfScale}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
