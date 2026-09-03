/**
 * 文档快照 —— 照抄 codemoss fileDocumentSnapshot.ts。
 *
 * 一次遍历建立行索引 + UTF-8 字节数 + 内容哈希;getLineText/getLines 按行取原文。
 * 消费方:结构化预览的超限回退(只展示前 N 行)、表格/文档预算度量。
 */

export type FileDocumentLineRange = {
  start: number;
  end: number;
};

export type FileDocumentSnapshot = {
  content: string;
  contentHash: string;
  byteLength: number;
  lineCount: number;
  truncated: boolean;
  snapshotVersion: number;
  getLineText: (lineIndex: number) => string;
  getLineRange: (lineIndex: number) => FileDocumentLineRange | null;
  getLines: (startLineIndex: number, endLineIndexExclusive: number) => string[];
};

const EMPTY_LINE_STARTS: number[] = [];
const EMPTY_LINE_ENDS: number[] = [];

function nextHashValue(hash: number, codeUnit: number) {
  return (hash * 31 + codeUnit) >>> 0;
}

function utf8ByteLengthForCodePoint(value: string, index: number) {
  const codeUnit = value.charCodeAt(index);
  if (codeUnit < 0x80) {
    return { byteLength: 1, nextIndex: index };
  }
  if (codeUnit < 0x800) {
    return { byteLength: 2, nextIndex: index };
  }
  if (
    codeUnit >= 0xd800 &&
    codeUnit <= 0xdbff &&
    index + 1 < value.length
  ) {
    const nextCodeUnit = value.charCodeAt(index + 1);
    if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
      return { byteLength: 4, nextIndex: index + 1 };
    }
  }
  return { byteLength: 3, nextIndex: index };
}

function buildDocumentIndex(value: string) {
  if (value.length === 0) {
    return {
      byteLength: 0,
      contentHash: "0",
      lineStarts: EMPTY_LINE_STARTS,
      lineEnds: EMPTY_LINE_ENDS,
    };
  }

  const lineStarts: number[] = [0];
  const lineEnds: number[] = [];
  let byteLength = 0;
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit === 13 && value.charCodeAt(index + 1) === 10) {
      hash = nextHashValue(hash, codeUnit);
      hash = nextHashValue(hash, 10);
      byteLength += 2;
      lineEnds.push(index);
      index += 1;
      lineStarts.push(index + 1);
      continue;
    }

    const encoded = utf8ByteLengthForCodePoint(value, index);
    byteLength += encoded.byteLength;
    hash = nextHashValue(hash, codeUnit);
    if (encoded.nextIndex !== index) {
      index = encoded.nextIndex;
      hash = nextHashValue(hash, value.charCodeAt(index));
      continue;
    }

    if (codeUnit === 10) {
      lineEnds.push(index);
      lineStarts.push(index + 1);
    }
  }

  lineEnds.push(value.length);

  return {
    byteLength,
    contentHash: hash.toString(36),
    lineStarts,
    lineEnds,
  };
}

export function createFileDocumentSnapshot(
  content: string,
  truncated: boolean,
  snapshotVersion: number,
): FileDocumentSnapshot {
  const index = buildDocumentIndex(content);

  const getLineRange = (lineIndex: number): FileDocumentLineRange | null => {
    if (
      lineIndex < 0 ||
      lineIndex >= index.lineStarts.length ||
      lineIndex >= index.lineEnds.length
    ) {
      return null;
    }
    return {
      start: index.lineStarts[lineIndex] ?? 0,
      end: index.lineEnds[lineIndex] ?? 0,
    };
  };

  const getLineText = (lineIndex: number) => {
    const range = getLineRange(lineIndex);
    return range ? content.slice(range.start, range.end) : "";
  };

  const getLines = (startLineIndex: number, endLineIndexExclusive: number) => {
    const start = Math.max(0, startLineIndex);
    const end = Math.min(index.lineStarts.length, endLineIndexExclusive);
    const lines: string[] = [];
    for (let lineIndex = start; lineIndex < end; lineIndex += 1) {
      lines.push(getLineText(lineIndex));
    }
    return lines;
  };

  return {
    content,
    contentHash: index.contentHash,
    byteLength: index.byteLength,
    lineCount: index.lineStarts.length,
    truncated,
    snapshotVersion,
    getLineText,
    getLineRange,
    getLines,
  };
}
