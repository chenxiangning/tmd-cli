/**
 * PDF / docx 文档大纲提取 —— 照抄 codemoss filePreviewOutline.ts。
 *
 * - extractPdfPreviewOutline:pdf.js 文档 outline 树 → 侧栏条目(dest 解析到页码,
 *   解析不到时借第一个子条目目标兜底);
 * - extractDocumentPreviewOutline:HTML → 标题大纲(DOMParser 注入唯一锚点 id)。
 * 与 codemoss 差异:类型本地定义(pdf-page/html-anchor target),侧栏组件复用
 * markdown/PreviewOutlineSidebar(已泛型化);node 测试环境无 DOMParser 时原样返回。
 */

import type { PDFDocumentProxy } from "pdfjs-dist";

export type PreviewOutlineTarget =
  | { kind: "pdf-page"; pageNumber: number }
  | { kind: "html-anchor"; anchorId: string };

export type PreviewOutlineItem = {
  id: string;
  title: string;
  level: number;
  children: PreviewOutlineItem[];
  target: PreviewOutlineTarget;
};

export type DocumentPreviewOutlineResult = {
  html: string;
  outline: PreviewOutlineItem[];
};

/** pdf.js getOutline() 条目的最小结构形状(v5 未导出命名类型,这里具名固化)。 */
type PdfOutlineNode = {
  title: string | null;
  dest: string | Array<unknown> | null;
  items: PdfOutlineNode[] | null;
};

type PdfReference = {
  num: number;
  gen: number;
};


function isRefProxy(value: unknown): value is PdfReference {
  if (typeof value !== "object" || value == null) {
    return false;
  }
  const maybeRef = value as { num?: unknown; gen?: unknown };
  return typeof maybeRef.num === "number" && typeof maybeRef.gen === "number";
}

function normalizeOutlineTitle(title: string | null | undefined, fallback: string) {
  const trimmed = title?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function normalizePdfPageNumber(pageNumber: number, totalPages: number) {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > totalPages) {
    return null;
  }
  return pageNumber;
}

function createUniqueAnchorId(
  usedAnchorIds: Set<string>,
  preferredId: string | null | undefined,
  fallbackId: string,
) {
  const normalizedPreferredId = preferredId?.trim() ?? "";
  if (normalizedPreferredId && !usedAnchorIds.has(normalizedPreferredId)) {
    usedAnchorIds.add(normalizedPreferredId);
    return normalizedPreferredId;
  }

  let nextAnchorId = fallbackId;
  let suffix = 1;
  while (usedAnchorIds.has(nextAnchorId)) {
    nextAnchorId = `${fallbackId}-${suffix}`;
    suffix += 1;
  }
  usedAnchorIds.add(nextAnchorId);
  return nextAnchorId;
}

async function resolvePdfDestinationPageNumber(
  pdfDocument: PDFDocumentProxy,
  destination: string | Array<unknown> | null,
) {
  if (!destination) {
    return null;
  }

  const resolvedDestination = typeof destination === "string"
    ? await pdfDocument.getDestination(destination)
    : destination;

  if (!resolvedDestination || resolvedDestination.length === 0) {
    return null;
  }

  const firstEntry = resolvedDestination[0];
  if (typeof firstEntry === "number" && Number.isFinite(firstEntry)) {
    return normalizePdfPageNumber(firstEntry + 1, pdfDocument.numPages);
  }
  if (!isRefProxy(firstEntry)) {
    return null;
  }

  const pageIndex = await pdfDocument.getPageIndex(firstEntry);
  return normalizePdfPageNumber(pageIndex + 1, pdfDocument.numPages);
}

async function mapPdfOutlineItems(
  pdfDocument: PDFDocumentProxy,
  items: PdfOutlineNode[],
  level: number,
  pathPrefix: string,
  untitledLabel: string,
): Promise<PreviewOutlineItem[]> {
  const mappedItems = await Promise.all(items.map(async (item, index) => {
    const children = await mapPdfOutlineItems(
      pdfDocument,
      item.items ?? [],
      level + 1,
      `${pathPrefix}-${index}`,
      untitledLabel,
    );
    const pageNumber = await resolvePdfDestinationPageNumber(pdfDocument, item.dest);
    const fallbackTarget = children[0]?.target ?? null;

    if (!pageNumber && !fallbackTarget) {
      return null;
    }

    return {
      id: `pdf-outline${pathPrefix}-${index}`,
      title: normalizeOutlineTitle(item.title, `${untitledLabel} ${index + 1}`),
      level,
      children,
      target: pageNumber
        ? { kind: "pdf-page" as const, pageNumber }
        : fallbackTarget!,
    };
  }));

  return mappedItems.filter((item): item is PreviewOutlineItem => item != null);
}

export async function extractPdfPreviewOutline(
  pdfDocument: PDFDocumentProxy,
  untitledLabel: string,
) {
  const outline = await pdfDocument.getOutline();
  if (!outline || outline.length === 0) {
    return [];
  }
  return mapPdfOutlineItems(pdfDocument, outline, 1, "", untitledLabel);
}

export function extractDocumentPreviewOutline(
  html: string,
  untitledLabel: string,
): DocumentPreviewOutlineResult {
  if (typeof DOMParser === "undefined") {
    return {
      html,
      outline: [],
    };
  }

  const parsedDocument = new DOMParser().parseFromString(html, "text/html");
  const headings = Array.from(parsedDocument.body.querySelectorAll("h1,h2,h3,h4,h5,h6"));

  if (headings.length === 0) {
    return {
      html,
      outline: [],
    };
  }

  const rootItems: PreviewOutlineItem[] = [];
  const parentStack: PreviewOutlineItem[] = [];
  const usedAnchorIds = new Set<string>();

  headings.forEach((headingNode, index) => {
    const level = Number(headingNode.tagName.slice(1));
    const anchorId = createUniqueAnchorId(
      usedAnchorIds,
      headingNode.id,
      `file-preview-heading-${index}`,
    );
    const title = normalizeOutlineTitle(
      headingNode.textContent,
      `${untitledLabel} ${index + 1}`,
    );

    headingNode.id = anchorId;

    const nextItem: PreviewOutlineItem = {
      id: anchorId,
      title,
      level,
      children: [],
      target: {
        kind: "html-anchor",
        anchorId,
      },
    };

    while (parentStack.length > 0 && parentStack[parentStack.length - 1]!.level >= level) {
      parentStack.pop();
    }

    const parentItem = parentStack[parentStack.length - 1];
    if (parentItem) {
      parentItem.children.push(nextItem);
    } else {
      rootItems.push(nextItem);
    }

    parentStack.push(nextItem);
  });

  return {
    html: parsedDocument.body.innerHTML,
    outline: rootItems,
  };
}
