/**
 * hover 悬停卡渲染 —— markdown-it(html:false)渲染 LSP hover 内容,
 * 围栏代码块走 @kernel/syntaxHighlight(Prism)带语言徽标;链接渲染为
 * 纯文本(hover 一瞥场景不导航)。
 * 内容归一:Hover{contents} / MarkupContent{kind,value} / MarkedString
 * {language,value} / string / 数组,递归拍平为 markdown 串;MarkedString
 * 归一为围栏,签名行因此获得语法高亮。初版 hoverText 对规范形态
 * Hover{contents:MarkupContent}(对象非数组)返回 null,此处一并修正。
 */

import MarkdownIt from "markdown-it";
import { highlightLine } from "@kernel/syntaxHighlight";

const MAX_HOVER_CHARS = 4000;

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: false,
  typographer: false,
});
const escapeHtml = md.utils.escapeHtml;

/* 围栏:与 files 快路径同构(语言徽标 + Prism 高亮),无复制按钮(只读一瞥)。 */
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  const lang = token.info.trim().split(/\s+/)[0] || "";
  return (
    `<div class="lsp-hover-code"><div class="lsp-hover-code-label">${escapeHtml(lang || "code")}</div>` +
    `<pre><code>${highlightLine(token.content, lang || null)}</code></pre></div>`
  );
};
md.renderer.rules.code_block = md.renderer.rules.fence;

/* 链接不导航:渲染为等宽文本保留可读。 */
md.renderer.rules.link_open = () => `<span class="lsp-hover-link">`;
md.renderer.rules.link_close = () => `</span>`;

function fenced(language: string, value: string): string {
  return `\`\`\`${language}\n${value}\n\`\`\``;
}

function collect(node: unknown): string[] {
  if (node == null) return [];
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(collect);
  if (typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (typeof record.value === "string") {
      return [typeof record.language === "string" ? fenced(record.language, record.value) : record.value];
    }
    if ("contents" in record) return collect(record.contents);
  }
  return [];
}

/** hover 响应归一为 markdown 串;空内容 null(不出 tooltip)。 */
export function hoverMarkdown(raw: unknown): string | null {
  const parts = collect(raw);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/** 渲染进 tooltip DOM(调用方负责 className);超长截断。 */
export function renderHoverCard(dom: HTMLElement, markdown: string): void {
  const text = markdown.length > MAX_HOVER_CHARS ? `${markdown.slice(0, MAX_HOVER_CHARS)}…` : markdown;
  dom.innerHTML = md.render(text);
}
