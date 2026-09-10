/**
 * PDF 文件预览 —— 照抄 codemoss FilePdfPreview.tsx。
 *
 * pdf.js 逐页 canvas 渲染:IntersectionObserver 视口外懒渲染(rootMargin 240px)、
 * devicePixelRatio 缩放、页窗口上限 200 页、缩放 0.75-3(步进 0.1)、
 * 文档 outline 侧栏(点击跳页并平移页窗口)。
 * 与 codemoss 差异:数据源从 asset:// fetch 改为 readBinaryFileBase64 字节通道
 * (getDocument({ data })),免 asset 作用域问题;文案走 t() 词典。
 * 单页 canvas 渲染组件拆至 PdfPageCanvas.tsx(文件规模铁则)。
 */

import { useEffect, useMemo, useReducer, useRef } from "react";
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import { ensurePdfPreviewWorker } from "./pdfRuntime";
import { PdfPageCanvas } from "./PdfPageCanvas";
import { loadPreviewBytes } from "./previewBytes";
import { t } from "@kernel/i18n";
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

type FilePdfPreviewProps = {
  path: string;
};
/* 预览器九项状态是同一台加载状态机(换 path 时整体复位),收进 useReducer,
   一次逻辑更新一次提交,不再九路 setState 各自触发渲染。 */
const initialPdfPreviewState = {
  pdfDocument: null as PDFDocumentProxy | null,
  numPages: 0,
  runtimeError: null as string | null,
  isRuntimeLoading: true,
  outlineItems: [] as PreviewOutlineItem[],
  activeOutlineItemId: null as string | null,
  pageWindowStart: 1,
  isOutlineCollapsed: false,
  pdfScale: DEFAULT_PDF_SCALE,
};
type PdfPreviewState = typeof initialPdfPreviewState;
type PdfPreviewAction = { type: "loaded"; pdfDocument: PDFDocumentProxy; numPages: number } | { type: "load-failed"; error: string } | { type: "outline-loaded"; items: PreviewOutlineItem[] } | { type: "select-outline-item"; id: string; pageWindowStart: number } | { type: "toggle-outline-collapsed" } | { type: "set-scale"; scale: number } | { type: "reset" };

function pdfPreviewReducer(state: PdfPreviewState, action: PdfPreviewAction): PdfPreviewState {
  switch (action.type) {
    /* reset = 换 path 重新进入加载相位(旧版 effect 首行 setIsRuntimeLoading(true)):
       加载完成/失败才会落回 false,加载期不得误报「无法加载 PDF 预览」。 */
    case "reset": return { ...initialPdfPreviewState, isRuntimeLoading: true };
    case "loaded": return { ...state, pdfDocument: action.pdfDocument, numPages: action.numPages, runtimeError: null, isRuntimeLoading: false };
    case "load-failed": return { ...initialPdfPreviewState, runtimeError: action.error };
    case "outline-loaded": return { ...state, outlineItems: action.items };
    case "select-outline-item": return { ...state, activeOutlineItemId: action.id, pageWindowStart: action.pageWindowStart };
    case "toggle-outline-collapsed": return { ...state, isOutlineCollapsed: !state.isOutlineCollapsed };
    case "set-scale": return { ...state, pdfScale: action.scale };
  }
}

export function FilePdfPreview({ path }: FilePdfPreviewProps) {
  const previewRootRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollPageNumberRef = useRef<number | null>(null);
  const [state, dispatch] = useReducer(pdfPreviewReducer, initialPdfPreviewState);
  const { pdfDocument, numPages, runtimeError, isRuntimeLoading, outlineItems, activeOutlineItemId, pageWindowStart, isOutlineCollapsed, pdfScale } = state;

  useEffect(() => {
    dispatch({ type: "reset" });

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
        dispatch({ type: "loaded", pdfDocument: nextDocument, numPages: nextDocument.numPages });
      } catch (loadError) {
        if (disposed) return;
        dispatch({ type: "load-failed", error: loadError instanceof Error ? loadError.message : String(loadError) });
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
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const nextOutlineItems = await extractPdfPreviewOutline(pdfDocument, t("未命名"));
        if (!cancelled) {
          dispatch({ type: "outline-loaded", items: nextOutlineItems });
        }
      } catch {
        if (!cancelled) {
          dispatch({ type: "outline-loaded", items: [] });
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

    dispatch({ type: "select-outline-item", id: item.id, pageWindowStart: nextWindowStart });
    pendingScrollPageNumberRef.current = nextPageNumber;

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
    return <div className="fvp-status">{t("加载中…")}</div>;
  }

  if (runtimeError) {
    return <div className="fvp-status fvp-error">{runtimeError}</div>;
  }

  if (!pdfDocument) {
    return <div className="fvp-status">{t("无法加载 PDF 预览")}</div>;
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
              <strong>{t("PDF 预览")}</strong>
              <span>{t("共 {n} 页", { n: numPages })}</span>
            </div>
            <div className="fvp-preview-toolbar" role="toolbar" aria-label={t("PDF 缩放工具栏")}>
              {outlineItems.length > 0 ? (
                <button
                  type="button"
                  className="fvp-preview-toolbar-button"
                  onClick={() => dispatch({ type: "toggle-outline-collapsed" })}
                >
                  {isOutlineCollapsed ? t("展开目录") : t("收起目录")}
                </button>
              ) : null}
              <button
                type="button"
                className="fvp-preview-toolbar-button"
                aria-label={t("缩小")}
                disabled={pdfScale <= MIN_PDF_SCALE}
                onClick={() => dispatch({ type: "set-scale", scale: Math.max(MIN_PDF_SCALE, Math.round((pdfScale - PDF_SCALE_STEP) * 100) / 100) })}
              >
                -
              </button>
              <button
                type="button"
                className="fvp-preview-toolbar-button fvp-preview-toolbar-value"
                aria-label={t("重置缩放")}
                onClick={() => dispatch({ type: "set-scale", scale: DEFAULT_PDF_SCALE })}
              >
                {`${Math.round(pdfScale * 100)}%`}
              </button>
              <button
                type="button"
                className="fvp-preview-toolbar-button"
                aria-label={t("放大")}
                disabled={pdfScale >= MAX_PDF_SCALE}
                onClick={() => dispatch({ type: "set-scale", scale: Math.min(MAX_PDF_SCALE, Math.round((pdfScale + PDF_SCALE_STEP) * 100) / 100) })}
              >
                +
              </button>
            </div>
          </header>
          {isPageCountTruncated ? (
            <div className="fvp-preview-budget-hint">
              {t("文档共 {total} 页,当前展示第 {start} 页起的 {count} 页", {
                total: numPages,
                start: normalizedPageWindowStart,
                count: visiblePageCount,
              })}
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
