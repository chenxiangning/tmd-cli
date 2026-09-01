/**
 * KaTeX 资产懒加载 + 公式渲染 —— 照抄 codemoss markdownMath.ts 的核心子集。
 *
 * 保留:katex/rehype-katex/katex.min.css 动态 import 缓存、数学内容探测、
 * 定界符解包、renderToString(throwOnError:false)。
 * 裁剪:面向聊天流的 LaTeX 容错归一化(~600 行),文件预览不背。
 */

import type katexDefault from "katex";
import type rehypeKatexDefault from "rehype-katex";

export type KatexModule = typeof katexDefault;
export type RehypeKatexPlugin = typeof rehypeKatexDefault;

let cachedKatex: KatexModule | null = null;
let cachedRehypeKatex: RehypeKatexPlugin | null = null;
let katexCssLoaded = false;
let katexLoadingPromise: Promise<void> | null = null;

export function getCachedKatex() {
  return cachedKatex;
}

export function getCachedRehypeKatex() {
  return cachedRehypeKatex;
}

export function areKatexAssetsReady() {
  return cachedKatex !== null && cachedRehypeKatex !== null && katexCssLoaded;
}

export function loadKatexAssets(): Promise<void> {
  if (areKatexAssetsReady()) {
    return Promise.resolve();
  }
  if (katexLoadingPromise) {
    return katexLoadingPromise;
  }
  // 有意 dynamic import:katex ~270KB + rehype-katex + css,只在文档含数学内容时加载(照抄 codemoss)
  katexLoadingPromise = Promise.all([
    import("katex").then((m) => {
      cachedKatex = m.default;
    }),
    import("rehype-katex").then((m) => {
      cachedRehypeKatex = m.default;
    }),
    import("katex/dist/katex.min.css").then(() => {
      katexCssLoaded = true;
    }),
  ]).then(() => undefined);
  return katexLoadingPromise;
}

const INLINE_DOLLAR_MATH = /(^|[^\\$])\$[^\n$]+?\$/;
const BLOCK_DOLLAR_MATH = /\$\$[\s\S]+?\$\$/;
const LATEX_PAREN_MATH = /\\\(|\\\[/;
const LATEX_CODE_FENCE = /```\s*(?:latex|tex|math)\b/i;

export function detectMathContent(value: string | undefined | null): boolean {
  if (!value) return false;
  if (LATEX_CODE_FENCE.test(value)) return true;
  if (BLOCK_DOLLAR_MATH.test(value)) return true;
  if (INLINE_DOLLAR_MATH.test(value)) return true;
  if (LATEX_PAREN_MATH.test(value)) return true;
  return false;
}

/** 剥掉外层 $$…$$ / \[…\] / $…$ / \(…\) 定界符,取公式本体。 */
export function unwrapLatexDelimiters(source: string) {
  const trimmed = source.trim();
  if (!trimmed) {
    return trimmed;
  }
  const displayBlockMatch = trimmed.match(/^\$\$\s*([\s\S]*?)\s*\$\$$/);
  if (displayBlockMatch) {
    const inner = (displayBlockMatch[1] ?? "").trim();
    if (inner) {
      return inner;
    }
  }
  const displayParenMatch = trimmed.match(/^\\\[\s*([\s\S]*?)\s*\\\]$/);
  if (displayParenMatch) {
    const inner = (displayParenMatch[1] ?? "").trim();
    if (inner) {
      return inner;
    }
  }
  const inlineDollarMatch = trimmed.match(/^\$([^\n$]+?)\$$/);
  if (inlineDollarMatch) {
    const inner = (inlineDollarMatch[1] ?? "").trim();
    if (inner) {
      return inner;
    }
  }
  const inlineParenMatch = trimmed.match(/^\\\(\s*([\s\S]*?)\s*\\\)$/);
  if (inlineParenMatch) {
    const inner = (inlineParenMatch[1] ?? "").trim();
    if (inner) {
      return inner;
    }
  }
  return trimmed;
}

/** katex 未就绪/渲染失败 → null(消费方降级为代码块直渲)。 */
export function renderLatexFormula(source: string) {
  if (!cachedKatex) return null;
  try {
    const renderedHtml = cachedKatex.renderToString(unwrapLatexDelimiters(source), {
      displayMode: true,
      throwOnError: false,
      strict: "ignore",
      trust: false,
    });
    return renderedHtml.includes("katex-error") ? null : renderedHtml;
  } catch {
    return null;
  }
}
