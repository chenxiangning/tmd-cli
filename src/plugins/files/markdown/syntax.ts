/**
 * Prism 高亮器 —— 照抄 codemoss utils/syntax.ts。
 *
 * highlightLine 纯函数(text, language),带 LRU 缓存(大文档重渲染时
 * 避免每次 commit 重跑 Prism 分词);输出经 sanitizePrismHtml 防御性清洗。
 * 与 codemoss 差异:escapeHtml/语言别名内联,不依赖其 fileLanguageRegistry。
 */

import Prism, { type Grammar } from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-c";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-css";
import "prismjs/components/prism-dart";
import "prismjs/components/prism-diff";
import "prismjs/components/prism-go";
import "prismjs/components/prism-git";
import "prismjs/components/prism-groovy";
import "prismjs/components/prism-ini";
import "prismjs/components/prism-java";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-php";
import "prismjs/components/prism-properties";
import "prismjs/components/prism-python";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-scss";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-yaml";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Prism.highlight 输出的纵深防御清洗。
 * Prism 只产出 `<span class="token ...">` + HTML 转义内容,
 * 但 strip 掉意外产物作为安全网。
 */
function sanitizePrismHtml(html: string): string {
  return html
    .replace(/<script[\s>][\s\S]*?<\/script>/gi, "")
    .replace(/\bon\w+\s*=/gi, "data-removed=");
}

const MAX_HIGHLIGHT_CACHE_ENTRIES = 4000;
const highlightCache = new Map<string, string>();

function readHighlightCache(cacheKey: string) {
  const cached = highlightCache.get(cacheKey);
  if (cached === undefined) {
    return undefined;
  }
  highlightCache.delete(cacheKey);
  highlightCache.set(cacheKey, cached);
  return cached;
}

function writeHighlightCache(cacheKey: string, html: string) {
  highlightCache.delete(cacheKey);
  highlightCache.set(cacheKey, html);
  while (highlightCache.size > MAX_HIGHLIGHT_CACHE_ENTRIES) {
    const oldestKey = highlightCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    highlightCache.delete(oldestKey);
  }
}

export function highlightLine(text: string, language?: string | null) {
  if (!language || !(Prism.languages as Record<string, unknown>)[language]) {
    return escapeHtml(text);
  }
  const cacheKey = `${language}\0${text}`;
  const cached = readHighlightCache(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const html = sanitizePrismHtml(
    Prism.highlight(text, Prism.languages[language] as Grammar, language),
  );
  writeHighlightCache(cacheKey, html);
  return html;
}
