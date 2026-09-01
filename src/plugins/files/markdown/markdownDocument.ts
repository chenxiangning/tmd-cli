/**
 * markdown 文档编译器 —— 照抄 codemoss fileMarkdownDocument.ts。
 *
 * 职责:frontmatter 提取 + 按空行/围栏/表格切块 + 编译结果 LRU 缓存。
 * 与 codemoss 的差异(有意裁剪):
 * - 数学归一化(normalizeMarkdownMathForFilePreview)不做改写,lineMap 恒等;
 *   codemoss 的 LaTeX 容错归一化(~600 行)面向聊天流,文件预览场景先不背这个复杂度。
 * - 无 rendererProfile 维度(单一 GitHub 风格 profile)。
 */

export type FileMarkdownFrontmatterField = {
  key: string;
  value: string;
};

export type FileMarkdownDocumentBlock = {
  key: string;
  markdown: string;
  startLine: number;
  endLine: number;
};

export type CompiledFileMarkdownDocument = {
  cacheKey: string;
  contentHash: string;
  documentKey: string;
  frontmatterFields: FileMarkdownFrontmatterField[];
  body: string;
  bodyStartLine: number;
  lineMap: number[];
  blocks: FileMarkdownDocumentBlock[];
  metrics: {
    byteLength: number;
    lineCount: number;
    blockCount: number;
    heavyBlockCount: number;
  };
  renderStrategy: "rich" | "progressive";
};

const MAX_COMPILED_DOCUMENTS = 30;
const MAX_RICH_MARKDOWN_BYTES = 96_000;
const MAX_RICH_MARKDOWN_LINES = 2_500;
const MAX_RICH_MARKDOWN_BLOCKS = 900;
const MAX_RICH_HEAVY_BLOCKS = 20;
const MAX_PLAIN_MARKDOWN_BLOCK_LINES = 80;
const compiledDocumentCache = new Map<string, CompiledFileMarkdownDocument>();

export function hashStableString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function normalizeFrontmatterValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => normalizeFrontmatterValue(item))
      .filter(Boolean)
      .join(" · ");
  }
  return trimmed;
}

function extractFrontmatter(value: string): {
  fields: FileMarkdownFrontmatterField[];
  body: string;
  bodyStartLine: number;
} {
  const match = value.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) {
    return { fields: [], body: value, bodyStartLine: 1 };
  }

  const frontmatterBlock = match[1] ?? "";
  const fields = frontmatterBlock
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex <= 0) {
        return null;
      }
      return {
        key: line.slice(0, separatorIndex).trim(),
        value: normalizeFrontmatterValue(line.slice(separatorIndex + 1).trim()),
      };
    })
    .filter((field): field is FileMarkdownFrontmatterField => Boolean(field));

  return {
    fields,
    body: value.slice(match[0].length),
    bodyStartLine: (match[0].match(/\r?\n/g) ?? []).length + 1,
  };
}

function countMarkdownBlocks(value: string) {
  const lines = value.split(/\r?\n/);
  let blockCount = 0;
  let heavyBlockCount = 0;
  let insideFence = false;
  let fenceLanguage = "";
  let previousWasBlank = true;

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^```+\s*([\w-]+)?/);
    if (fenceMatch) {
      if (!insideFence) {
        blockCount += 1;
        fenceLanguage = (fenceMatch[1] ?? "").toLowerCase();
        if (["mermaid", "math", "latex", "tex"].includes(fenceLanguage)) {
          heavyBlockCount += 1;
        }
      }
      insideFence = !insideFence;
      previousWasBlank = false;
      continue;
    }

    if (insideFence) {
      continue;
    }
    if (!trimmed) {
      previousWasBlank = true;
      continue;
    }
    if (/^#{1,6}\s/.test(trimmed) || /^>\s?/.test(trimmed) || /^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed) || /^\|/.test(trimmed)) {
      blockCount += 1;
      previousWasBlank = false;
      if (/^\|/.test(trimmed)) {
        heavyBlockCount += 1;
      }
      continue;
    }
    if (previousWasBlank) {
      blockCount += 1;
    }
    previousWasBlank = false;
  }

  return { blockCount, heavyBlockCount };
}

function createBlockKey(markdown: string, startLine: number, endLine: number) {
  return `${startLine}:${endLine}:${hashStableString(markdown)}`;
}

function createMarkdownBlock(
  lines: string[],
  startIndex: number,
  endIndexExclusive: number,
): FileMarkdownDocumentBlock | null {
  if (startIndex >= endIndexExclusive) {
    return null;
  }
  const markdown = lines.slice(startIndex, endIndexExclusive).join("\n");
  const startLine = startIndex + 1;
  const endLine = endIndexExclusive;
  return {
    key: createBlockKey(markdown, startLine, endLine),
    markdown,
    startLine,
    endLine,
  };
}

function isFenceOpeningLine(line: string) {
  return line.trim().match(/^(`{3,}|~{3,})/);
}

function isPipeTableDelimiterLine(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isPipeTableCandidateLine(line: string) {
  const trimmed = line.trim();
  return trimmed.includes("|") && !isFenceOpeningLine(trimmed);
}

function isPipeTableStart(lines: string[], index: number) {
  return (
    isPipeTableCandidateLine(lines[index] ?? "") &&
    isPipeTableDelimiterLine(lines[index + 1] ?? "")
  );
}

function isPipeTableContinuationLine(line: string) {
  return isPipeTableCandidateLine(line) || isPipeTableDelimiterLine(line);
}

function shouldKeepMarkdownBlockAtomic(lines: string[], startIndex: number, endIndexExclusive: number) {
  for (let index = startIndex; index < endIndexExclusive; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trimStart();
    if (
      trimmed.startsWith(">") ||
      /^[-+*]\s+/.test(trimmed) ||
      /^\d+[.)]\s+/.test(trimmed) ||
      /^\[[ xX]\]\s+/.test(trimmed) ||
      /^\$\$/.test(trimmed) ||
      /^ {4,}\S/.test(line)
    ) {
      return true;
    }
  }
  return false;
}

export function segmentMarkdownDocumentBlocks(value: string): FileMarkdownDocumentBlock[] {
  if (!value) {
    return [];
  }
  const lines = value.split(/\r?\n/);
  const blocks: FileMarkdownDocumentBlock[] = [];
  let blockStartIndex: number | null = null;
  let index = 0;

  const pushBlock = (endIndexExclusive: number) => {
    if (blockStartIndex === null) {
      return;
    }
    if (shouldKeepMarkdownBlockAtomic(lines, blockStartIndex, endIndexExclusive)) {
      const block = createMarkdownBlock(lines, blockStartIndex, endIndexExclusive);
      if (block) {
        blocks.push(block);
      }
      blockStartIndex = null;
      return;
    }
    for (
      let chunkStartIndex = blockStartIndex;
      chunkStartIndex < endIndexExclusive;
      chunkStartIndex += MAX_PLAIN_MARKDOWN_BLOCK_LINES
    ) {
      const chunkEndIndex = Math.min(
        chunkStartIndex + MAX_PLAIN_MARKDOWN_BLOCK_LINES,
        endIndexExclusive,
      );
      const block = createMarkdownBlock(lines, chunkStartIndex, chunkEndIndex);
      if (block) {
        blocks.push(block);
      }
    }
    blockStartIndex = null;
  };

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      pushBlock(index);
      index += 1;
      continue;
    }

    const fenceMatch = isFenceOpeningLine(line);
    if (fenceMatch) {
      pushBlock(index);
      const marker = fenceMatch[1] ?? "```";
      const markerChar = marker[0] ?? "`";
      const fenceStartIndex = index;
      index += 1;
      while (index < lines.length) {
        const candidate = (lines[index] ?? "").trim();
        if (candidate.startsWith(markerChar.repeat(3))) {
          index += 1;
          break;
        }
        index += 1;
      }
      const block = createMarkdownBlock(lines, fenceStartIndex, index);
      if (block) {
        blocks.push(block);
      }
      continue;
    }

    if (isPipeTableStart(lines, index)) {
      pushBlock(index);
      const tableStartIndex = index;
      index += 2;
      while (index < lines.length && isPipeTableContinuationLine(lines[index] ?? "")) {
        index += 1;
      }
      const block = createMarkdownBlock(lines, tableStartIndex, index);
      if (block) {
        blocks.push(block);
      }
      continue;
    }

    if (blockStartIndex === null) {
      blockStartIndex = index;
    }
    index += 1;
  }

  pushBlock(lines.length);
  return blocks;
}

function resolveRenderStrategy(metrics: CompiledFileMarkdownDocument["metrics"]) {
  if (
    metrics.byteLength > MAX_RICH_MARKDOWN_BYTES ||
    metrics.lineCount > MAX_RICH_MARKDOWN_LINES ||
    metrics.blockCount > MAX_RICH_MARKDOWN_BLOCKS ||
    metrics.heavyBlockCount > MAX_RICH_HEAVY_BLOCKS
  ) {
    return "progressive" as const;
  }
  return "rich" as const;
}

/** 恒等 lineMap(不做数学归一化改写):lineMap[i] = i+1。 */
function identityLineMap(lineCount: number): number[] {
  return Array.from({ length: lineCount }, (_, index) => index + 1);
}

export function compileFileMarkdownDocument(
  documentKey: string,
  rawMarkdown: string,
): CompiledFileMarkdownDocument {
  const contentHash = hashStableString(rawMarkdown);
  const cacheKey = `${documentKey}:${contentHash}`;
  const cachedDocument = compiledDocumentCache.get(cacheKey);
  if (cachedDocument) {
    compiledDocumentCache.delete(cacheKey);
    compiledDocumentCache.set(cacheKey, cachedDocument);
    return cachedDocument;
  }

  const frontmatter = extractFrontmatter(rawMarkdown);
  const blockMetrics = countMarkdownBlocks(frontmatter.body);
  const blocks = segmentMarkdownDocumentBlocks(frontmatter.body);
  const lineCount = rawMarkdown.length === 0 ? 0 : rawMarkdown.split(/\r?\n/).length;
  const bodyLineCount =
    frontmatter.body.length === 0 ? 0 : frontmatter.body.split(/\r?\n/).length;
  const metrics = {
    byteLength: new TextEncoder().encode(rawMarkdown).length,
    lineCount,
    blockCount: blockMetrics.blockCount,
    heavyBlockCount: blockMetrics.heavyBlockCount,
  };
  const compiledDocument: CompiledFileMarkdownDocument = {
    cacheKey,
    contentHash,
    documentKey,
    frontmatterFields: frontmatter.fields,
    body: frontmatter.body,
    bodyStartLine: frontmatter.bodyStartLine,
    lineMap: identityLineMap(bodyLineCount),
    blocks,
    metrics,
    renderStrategy: resolveRenderStrategy(metrics),
  };

  compiledDocumentCache.set(cacheKey, compiledDocument);
  while (compiledDocumentCache.size > MAX_COMPILED_DOCUMENTS) {
    const oldestKey = compiledDocumentCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    compiledDocumentCache.delete(oldestKey);
  }
  return compiledDocument;
}

export function clearFileMarkdownDocumentCacheForTests() {
  compiledDocumentCache.clear();
}
