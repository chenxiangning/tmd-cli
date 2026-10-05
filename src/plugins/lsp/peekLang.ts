/**
 * peek/hover 共用的扩展名 → Prism 语言 id 解析(自 peekWidget 抽出:
 * peekWidget 已 import peekList,列表回填高亮需同源解析,反向 import 会成环)。
 * 常见族全表;缺省 null = 原样转义不上色。
 */

export const PRISM_LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  py: "python",
  java: "java",
  rs: "rust",
  go: "go",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  css: "css",
  scss: "scss",
  json: "json",
  sh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  sql: "sql",
  rb: "ruby",
  kt: "kotlin",
  swift: "swift",
  php: "php",
};

export function prismLangOf(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  return PRISM_LANG_BY_EXT[path.slice(dot + 1).toLowerCase()] ?? null;
}
