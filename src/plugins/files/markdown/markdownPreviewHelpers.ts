/**
 * FileMarkdownPreview 纯函数助手 —— 自 FileMarkdownPreview.tsx 拆出(文件规模铁则)。
 * pre 节点代码提取 / mermaid·math 语言判定 / 重块阈值 / 文档级特性探测 /
 * mermaid 块稳定 key;无 React 依赖,行为逐字保留。
 */

import type { Element } from "hast";
import { hashStableString } from "./markdownDocument";

export type PreviewPreNode = {
  children?: Array<{
    tagName?: string;
    properties?: { className?: string[] | string };
    children?: Array<{ value?: string }>;
  }>;
};

export type MarkdownPositionTreeNode = Element | undefined;

const HEAVY_CODE_BLOCK_LINE_THRESHOLD = 80;
const HEAVY_CODE_BLOCK_BYTE_THRESHOLD = 12_000;

export function extractCodeFromPre(node?: PreviewPreNode) {
  const codeNode = node?.children?.find((child) => child.tagName === "code");
  const className = codeNode?.properties?.className;
  const normalizedClassName = Array.isArray(className)
    ? className.join(" ")
    : className;
  const value =
    codeNode?.children?.map((child) => child.value ?? "").join("") ?? "";
  return {
    className: normalizedClassName,
    value: value.replace(/\n$/, ""),
  };
}

export function isMermaidCodeLanguage(languageTag: string | null) {
  return languageTag === "mermaid" || languageTag === "flowchart";
}

export function isMathCodeLanguage(languageTag: string | null) {
  return languageTag === "math" || languageTag === "latex" || languageTag === "tex";
}

export function isHeavyCodeBlock(value: string) {
  return (
    value.length > HEAVY_CODE_BLOCK_BYTE_THRESHOLD ||
    value.split(/\r?\n/).length > HEAVY_CODE_BLOCK_LINE_THRESHOLD
  );
}

export function hasDocumentScopedMarkdownFeatures(value: string) {
  return (
    /^\s{0,3}\[[^\]\n]+]:\s+\S+/m.test(value) ||
    /^\s{0,3}<([A-Za-z][\w:-]*)(?:\s[^>]*)?>[\s\S]*?^\s{0,3}<\/\1>\s*$/m.test(value)
  );
}

export function createMermaidBlockKey(
  node: MarkdownPositionTreeNode,
  value: string,
  blockStartLine: number,
): string {
  const startLine = (node?.position?.start.line ?? 1) + blockStartLine - 1;
  const endLine = (node?.position?.end.line ?? 1) + blockStartLine - 1;
  return `${startLine}:${endLine}:${hashStableString(value)}`;
}

/** 链接锚点与大纲标题的宽松匹配键:解码 + 小写 + 去空白/标点/符号,
 *  GitHub 风格 slug(`composer-工具栏设计`)与中文直书(`Composer 工具栏设计`)能对上。 */
export function normalizeMarkdownAnchorKey(value: string) {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    /* 非法编码保留原值。 */
  }
  return decoded.toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
}
