/**
 * markdown 快路径渲染器 —— 行为复刻 yn(Yank Note)的 markdown-it 单遍字符串管线。
 *
 * 设计(spec 2026-09-18-yn-replicate):常规块(无 mermaid/数学/raw HTML)用
 * markdown-it(html:false)一次 render 出 HTML 字符串直塞 innerHTML,跳过
 * remark AST → hast → React elements 三层转换;mermaid/数学/raw HTML 块留在
 * useMarkdownComponents 的 react-markdown 富路径。html:false 下 markdown-it
 * 转义一切原文,快路径零 XSS 面,无需 sanitize(yn 用 html:true + iframe 沙箱,
 * 本仓不需要该复杂度)。
 *
 * 交互元素(链接/图片/代码块复制)不走 React 组件:renderer 规则只打 data-*
 * 属性,由 BlockMarkdown 容器的事件委托统一分发(yn 的 VIEW_ELEMENT_CLICK hook
 * 代理同思路)。表格复用富路径 .fvp-file-markdown-table-wrap 滚动包裹的现成 CSS。
 */

import MarkdownIt from "markdown-it";
import { t } from "@kernel/i18n";
import { getSettingsState } from "@kernel/settings";
import { highlightLine } from "@kernel/syntaxHighlight";
import { resolveImageRenderSource, resolveMarkdownLinkTarget } from "./markdownImages";
import { isMathCodeLanguage, isMermaidCodeLanguage } from "./markdownPreviewHelpers";

/** 快路径渲染 env:仅承载当前文档的源文件路径(相对链接/图片解析基准)。 */
export interface FastRenderEnv {
  sourceFilePath?: string | null;
}

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
});

const escapeHtml = md.utils.escapeHtml;

/* file:// 链接与富路径对齐(富路径保留 href 并剥壳开 tab);markdown-it 默认
   BAD_PROTO_RE 拒 file:,这里放行后由 buildLinkOpenTag 的 file 分支受控消费。 */
const defaultValidateLink = md.validateLink.bind(md);
md.validateLink = (url: string) => defaultValidateLink(url) || /^file:/i.test(url.trim());

/* ── 任务列表(GFM checkbox):core 后处理 + 自定义行内 token ──
   html:false 会转义 html_inline,塞原始 <input> 不行;自定义 token 类型交
   renderer 规则输出,绕开转义。与 remark-gfm 的默认输出(裸 disabled input)对齐。 */
const TASK_MARKER = /^\[([ xX])\] +/;

md.core.ruler.push("tasklist", (state) => {
  const { tokens } = state;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "list_item_open") {
      continue;
    }
    const inline = tokens[i + 2];
    const children = inline?.children;
    if (!inline || inline.type !== "inline" || !children || children.length === 0) {
      continue;
    }
    const first = children[0];
    if (first.type !== "text") {
      continue;
    }
    const matched = TASK_MARKER.exec(first.content);
    if (!matched) {
      continue;
    }
    first.content = first.content.slice(matched[0].length);
    const checkbox = new state.Token("tasklist_checkbox", "input", 0);
    checkbox.attrJoin("class", "tmd-task-checkbox");
    if (matched[1] !== " ") {
      checkbox.attrSet("checked", "checked");
    }
    children.unshift(checkbox);
    tokens[i].attrJoin("class", "task-list-item");
  }
  return true;
});

md.renderer.rules.tasklist_checkbox = (tokens, idx) => {
  const token = tokens[idx];
  const checked = token.attrGet("checked") ? " checked" : "";
  return `<input type="checkbox" disabled${checked} class="tmd-task-checkbox"> `;
};

/* ── 代码块:复用 prism highlightLine(带缓存)拼接与富路径同构的 DOM ── */
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  const languageTag = token.info.trim().split(/\s+/)[0] || "";
  const highlighted = highlightLine(token.content, languageTag || null);
  const label = languageTag || "Code";
  const codeClass = languageTag ? ` class="language-${escapeHtml(languageTag)}"` : "";
  return (
    `<div class="fvp-file-markdown-codeblock">` +
    `<div class="fvp-file-markdown-codeblock-label">` +
    `<span class="markdown-codeblock-language">` +
    `<span class="markdown-codeblock-language-text">${escapeHtml(label)}</span>` +
    `</span>` +
    `<button type="button" class="ghost markdown-codeblock-copy" data-md-copy ` +
    `title="${escapeHtml(t("复制"))}">${escapeHtml(t("复制"))}</button>` +
    `</div>` +
    `<pre><code${codeClass}>${highlighted}</code></pre>` +
    `</div>\n`
  );
};

/* ── 表格:静态滚动包裹(富路径 FileMarkdownTableBlock 的滚动缓存是 React 态,
   快路径用同一 class 的纯 CSS 形态) ── */
md.renderer.rules.table_open = () => '<div class="fvp-file-markdown-table-wrap"><table>\n';
md.renderer.rules.table_close = () => "</table></div>\n";

/* ── 链接:分类打 data-* 属性,点击由容器委托分发(与富路径 handleAnchorClick
   同规则:外链系统浏览器 / 锚点滚预览 / 本地文件进 tab / 其余静默) ── */
function buildLinkOpenTag(href: string, title: string | null, sourceFilePath: string | null): string {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  const lower = href.toLowerCase();
  const protocolRelative = href.startsWith("//");
  if (
    protocolRelative ||
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("mailto:")
  ) {
    return `<a data-md-link="external" href="${escapeHtml(href)}"${titleAttr}>`;
  }
  if (href.startsWith("#")) {
    return `<a data-md-link="anchor" data-md-anchor="${escapeHtml(href.slice(1))}" href="#"${titleAttr}>`;
  }
  const target = resolveMarkdownLinkTarget(href, sourceFilePath);
  if (target) {
    return `<a data-md-link="file" data-md-path="${escapeHtml(target.path)}" href="#"${titleAttr}>`;
  }
  return `<a data-md-link="dead" href="#"${titleAttr}>`;
}

md.renderer.rules.link_open = (tokens, idx, _opts, env) => {
  const token = tokens[idx];
  const href = token.attrGet("href") ?? "#";
  const title = token.attrGet("title");
  /* 本地文件分支需要源文件路径做相对解析(env 透传,同 image 规则)。 */
  return buildLinkOpenTag(href, title, (env as FastRenderEnv).sourceFilePath ?? null);
};

/* ── 图片:渲染期同步解析本地路径(同富路径 resolveImageRenderSource),
   点击全屏由委托分发;asset:// 失败回退 dataURL 的异步重试是 LocalImage 的
   React 态,快路径不保留(绝大多数场景 assetUrl 直接可用)。 ── */
md.renderer.rules.image = (tokens, idx, _opts, env) => {
  const token = tokens[idx];
  const rawSrc = token.attrGet("src") ?? "";
  const alt = (token.children ?? [])
    .map((child) => (child.type === "text" ? child.content : ""))
    .join("");
  const resolved = resolveImageRenderSource(rawSrc, (env as FastRenderEnv).sourceFilePath ?? null);
  if (!resolved.src) {
    return "<img data-md-img-skipped alt=\"\">";
  }
  const title = token.attrGet("title");
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  return (
    `<img data-md-img="${escapeHtml(resolved.localPath ?? resolved.src)}" ` +
    `src="${escapeHtml(resolved.src)}" alt="${escapeHtml(alt)}"${titleAttr} loading="lazy">`
  );
};

/* ── 富块分类:命中任一条件走 react-markdown 富路径 ── */

/* 行首引用/列表标记(可叠加):> 、- 、* 、+ 、1. ——剥掉后再认栅栏,
   使 `> \`\`\`math` / `- \`\`\`mermaid` 这类嵌套栅栏正确落富路径(P2 评审项)。 */
const FENCE_PREFIX = /^(?:[ \t]*(?:>[ \t]?|[-*+][ \t]|\d{1,9}\.[ \t]))*[ \t]*/;
const FENCE_INFO = /(?:`{3,}|~{3,})[^\n`~]*$/;
const RAW_HTML = /<[a-zA-Z\/!]/;

/** 含数学定界符($..$ / $$..$$)即富块:与文档级 detectMathContent 同语义,正则内联避免循环依赖。 */
const MATH_DELIMITER = /\$\$[\s\S]*?\$\$|\$[^$\s](?:[^$\n]*[^$\s])?\$/;

/* 脚注定义(`[^x]: …`)即富块:markdown-it 无脚注语义,会把定义当普通链接定义、
   引用渲成伪文件链接;编译层把定义逐块追加,命中即该文档全块落 remark-gfm,
   与旧「整篇合并」同渲染器,脚注渲染平价。 */
const FOOTNOTE_DEFINITION = /^\s{0,3}\[\^[^\]\n]+\]:/m;

/**
 * 块是否需要富路径。纯文本/表格/常规代码块返回 false(快路径)。
 * 数学检测宽松(宁富勿快):误报只损失速度,不损失正确性。
 */
export function isRichBlock(markdown: string): boolean {
  if (RAW_HTML.test(markdown) || MATH_DELIMITER.test(markdown) || FOOTNOTE_DEFINITION.test(markdown)) {
    return true;
  }
  for (const line of markdown.split("\n")) {
    const bare = line.replace(FENCE_PREFIX, "");
    const fenceMatch = FENCE_INFO.exec(bare);
    if (!fenceMatch) {
      continue;
    }
    const info = fenceMatch[0].replace(/^(?:`{3,}|~{3,})[ \t]*/, "");
    const tag = info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (isMermaidCodeLanguage(tag) || isMathCodeLanguage(tag)) {
      return true;
    }
  }
  return false;
}

const fastHtmlCache = new Map<string, string>();
const FAST_CACHE_LIMIT = 600;

/**
 * 快路径渲染(带内容级缓存)。sourceFilePath 仅影响相对链接/图片解析,
 * 与 markdown 内容共同构成缓存键。
 */
export function renderFastMarkdown(markdown: string, sourceFilePath?: string | null): string {
  /* 语言进缓存键:fence renderer 把 t("复制") 烧进缓存 HTML,切换语言不得回放旧语言按钮 */
  const cacheKey = `${sourceFilePath ?? ""}\u0000${getSettingsState().settings.language}\u0000${markdown}`;
  const cached = fastHtmlCache.get(cacheKey);
  if (cached !== undefined) {
    /* 命中刷新插入序(LRU 语义,同 syntax.ts readHighlightCache)。 */
    fastHtmlCache.delete(cacheKey);
    fastHtmlCache.set(cacheKey, cached);
    return cached;
  }
  const html = md.render(markdown, { sourceFilePath } satisfies FastRenderEnv);
  if (fastHtmlCache.size >= FAST_CACHE_LIMIT) {
    const oldest = fastHtmlCache.keys().next().value;
    if (oldest !== undefined) {
      fastHtmlCache.delete(oldest);
    }
  }
  fastHtmlCache.set(cacheKey, html);
  return html;
}

/** 测试后门:清空快路径缓存。 */
export function clearFastPathCacheForTests(): void {
  fastHtmlCache.clear();
}
