/**
 * markdown 代码块语言标注解析 —— ```` ```ts ```` → "ts"(纯函数)。
 * 自 markdownBlocks.tsx 拆出(only-export-components):代码块/数学块/
 * mermaid 分发等消费方共用。
 */

export function extractLanguageTag(className?: string) {
  if (!className) {
    return null;
  }
  const match = className.match(/language-([\w-]+)/i);
  return match?.[1] ?? null;
}
