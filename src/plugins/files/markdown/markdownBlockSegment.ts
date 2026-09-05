/**
 * markdown 切块器 —— 自 markdownDocument.ts 拆出(文件规模铁则)。
 * 按空行/围栏/管道表格切块(列表/引用/任务/$$/缩进代码整块保持原子,
 * 长普通块按 80 行分片)+ 块形统计(重块 = mermaid/math 围栏与表格)。
 * hashStableString 与 FileMarkdownDocumentBlock 类型同住此层,
 * markdownDocument.ts re-export 保持原路径契约。
 */

export type FileMarkdownDocumentBlock = {
  key: string;
  markdown: string;
  startLine: number;
  endLine: number;
};

const MAX_PLAIN_MARKDOWN_BLOCK_LINES = 80;

export function hashStableString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

export function countMarkdownBlocks(value: string) {
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
