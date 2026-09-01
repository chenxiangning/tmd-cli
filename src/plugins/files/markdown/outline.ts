/**
 * markdown 章节大纲提取 —— 对应 codemoss filePreviewOutline.ts 的 md 侧。
 *
 * codemoss 走 mdast 解析器产出大纲;本端口复用 markdownDocument 的围栏感知切块,
 * 逐行匹配 ATX 标题(``` 围栏块已被切块隔离,不会误判)。
 * 树构建/锚点去重算法与 codemoss 一致(层级栈 + createUniqueAnchorId)。
 */

import { segmentMarkdownDocumentBlocks } from "./markdownDocument";

export type PreviewOutlineTarget = {
  kind: "html-anchor";
  anchorId: string;
  sourceStartLine?: number;
};

export type PreviewOutlineItem = {
  id: string;
  title: string;
  level: number;
  children: PreviewOutlineItem[];
  target: PreviewOutlineTarget;
};

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

function createUniqueAnchorId(usedAnchorIds: Set<string>, fallbackId: string) {
  let nextAnchorId = fallbackId;
  let suffix = 1;
  while (usedAnchorIds.has(nextAnchorId)) {
    nextAnchorId = `${fallbackId}-${suffix}`;
    suffix += 1;
  }
  usedAnchorIds.add(nextAnchorId);
  return nextAnchorId;
}

/** 从 markdown 正文提取标题大纲树;无标题返回空表。 */
export function extractMarkdownOutline(body: string): PreviewOutlineItem[] {
  if (!body) {
    return [];
  }
  /* 围栏代码块已被切块隔离:非围栏块里逐行找 ATX 标题,``` 内 # 注释不会误判。 */
  const blocks = segmentMarkdownDocumentBlocks(body);
  const headings: Array<{ level: number; title: string; startLine: number }> = [];
  for (const block of blocks) {
    if (/^(`{3,}|~{3,})/.test(block.markdown.trimStart())) {
      continue;
    }
    const lines = block.markdown.split("\n");
    lines.forEach((line, index) => {
      if (/^\s*>/.test(line)) {
        return; /* 引用块内标题不进大纲(与 codemoss 顶层语义一致) */
      }
      const match = line.match(HEADING_RE);
      if (!match) {
        return;
      }
      headings.push({
        level: match[1]!.length,
        title: match[2]!.trim(),
        startLine: block.startLine + index,
      });
    });
  }
  if (headings.length === 0) {
    return [];
  }

  const rootItems: PreviewOutlineItem[] = [];
  const parentStack: PreviewOutlineItem[] = [];
  const usedAnchorIds = new Set<string>();

  headings.forEach((heading, index) => {
    const anchorId = createUniqueAnchorId(usedAnchorIds, `fvp-md-heading-${index}`);
    const nextItem: PreviewOutlineItem = {
      id: anchorId,
      title: heading.title,
      level: heading.level,
      children: [],
      target: {
        kind: "html-anchor",
        anchorId,
        sourceStartLine: heading.startLine,
      },
    };
    while (parentStack.length > 0 && parentStack[parentStack.length - 1]!.level >= heading.level) {
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

  return rootItems;
}

export function flattenPreviewOutlineItems(items: PreviewOutlineItem[]): PreviewOutlineItem[] {
  const flattened: PreviewOutlineItem[] = [];
  const visit = (item: PreviewOutlineItem) => {
    flattened.push(item);
    item.children.forEach(visit);
  };
  items.forEach(visit);
  return flattened;
}
