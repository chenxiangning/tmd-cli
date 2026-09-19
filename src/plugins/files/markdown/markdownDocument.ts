/**
 * markdown 文档编译器 —— 照抄 codemoss fileMarkdownDocument.ts。
 *
 * 职责:frontmatter 提取 + 按空行/围栏/表格切块 + 编译结果 LRU 缓存。
 * 与 codemoss 的差异(有意裁剪):
 * - 数学归一化(normalizeMarkdownMathForFilePreview)不做改写,lineMap 恒等;
 *   codemoss 的 LaTeX 容错归一化(~600 行)面向聊天流,文件预览场景先不背这个复杂度。
 * - 无 rendererProfile 维度(单一 GitHub 风格 profile)。
 */

import {
  countMarkdownBlocks,
  segmentMarkdownDocumentBlocks,
  type FileMarkdownDocumentBlock,
} from "./markdownBlockSegment";
import { hashStableString } from "@kernel/textHash";

// 拆出后保持 ./markdownDocument 导出契约(消费方:outline/markdownBlocks/
// FileMarkdownPreview/markdownDocument.test)。
export { segmentMarkdownDocumentBlocks } from "./markdownBlockSegment";

type FileMarkdownFrontmatterField = {
  key: string;
  value: string;
};

type CompiledFileMarkdownDocument = {
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
const compiledDocumentCache = new Map<string, CompiledFileMarkdownDocument>();

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

/** 链接/脚注定义收集(含缩进续行):remark 对定义不产输出,逐块追加后跨块引用
 *  (定义在文末、使用在前文)在分块渲染下仍可解析——替代历史「整篇合并渲染」。
 *  围栏内的示例定义行也会被收集,仅多恢复一个同名引用,无渲染副作用。 */
function collectMarkdownDefinitions(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const definitions: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!/^\s{0,3}\[[^\]\n]+\]:\s*\S+/.test(line)) {
      continue;
    }
    const definitionLines = [line];
    while (index + 1 < lines.length && /^[ \t]+\S/.test(lines[index + 1] ?? "")) {
      index += 1;
      definitionLines.push(lines[index] ?? "");
    }
    definitions.push(definitionLines.join("\n"));
  }
  return definitions;
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
  const rawBlocks = segmentMarkdownDocumentBlocks(frontmatter.body);
  /* 定义行追加进每块 markdown(startLine/endLine 不动):键随内容 hash 重算。 */
  const definitions = collectMarkdownDefinitions(frontmatter.body);
  const definitionSuffix = definitions.length > 0 ? `\n\n${definitions.join("\n\n")}` : "";
  const blocks = definitionSuffix
    ? rawBlocks.map((block) => {
        const markdown = block.markdown + definitionSuffix;
        return {
          ...block,
          markdown,
          key: `${block.startLine}:${block.endLine}:${hashStableString(markdown)}`,
        };
      })
    : rawBlocks;
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
