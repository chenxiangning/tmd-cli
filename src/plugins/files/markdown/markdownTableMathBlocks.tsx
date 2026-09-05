/**
 * markdown 表格/数学块 —— 自 markdownBlocks.tsx 拆出(文件规模铁则)。
 * FileMarkdownTableBlock:横向滚动包裹 + scrollLeft LRU 缓存;
 * FileMarkdownMathBlock:katex renderToString(LRU 缓存),未就绪/失败降级代码块。
 */

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
  type UIEvent,
} from "react";
import { hashStableString } from "./markdownDocument";
import { renderLatexFormula } from "./markdownMath";
import {
  extractLanguageTag,
  FileMarkdownCodeBlock,
  LazyMarkdownHeavyBlock,
} from "./markdownBlocks";


const MAX_CACHED_TABLE_SCROLL_POSITIONS = 160;
const tableScrollPositionCache = new Map<string, number>();

function readCachedTableScrollPosition(cacheKey: string) {
  return tableScrollPositionCache.get(cacheKey) ?? 0;
}

function writeCachedTableScrollPosition(cacheKey: string, scrollLeft: number) {
  tableScrollPositionCache.delete(cacheKey);
  tableScrollPositionCache.set(cacheKey, Math.max(0, Math.round(scrollLeft)));
  while (tableScrollPositionCache.size > MAX_CACHED_TABLE_SCROLL_POSITIONS) {
    const oldestKey = tableScrollPositionCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    tableScrollPositionCache.delete(oldestKey);
  }
}

export function FileMarkdownTableBlock({
  children,
  defer,
  label,
  revealKey,
  scrollCacheKey,
}: {
  children: ReactNode;
  defer: boolean;
  label: string;
  revealKey: string | null;
  scrollCacheKey: string;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }
    const cachedScrollLeft = readCachedTableScrollPosition(scrollCacheKey);
    if (cachedScrollLeft > 0 && wrapper.scrollLeft !== cachedScrollLeft) {
      wrapper.scrollLeft = cachedScrollLeft;
    }
  }, [scrollCacheKey]);

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      writeCachedTableScrollPosition(scrollCacheKey, event.currentTarget.scrollLeft);
    },
    [scrollCacheKey],
  );

  return (
    <div
      ref={wrapperRef}
      className="fvp-file-markdown-table-wrap"
      onScroll={handleScroll}
    >
      <LazyMarkdownHeavyBlock defer={defer} label={label} revealKey={revealKey}>
        <table>{children}</table>
      </LazyMarkdownHeavyBlock>
    </div>
  );
}

/* ── 数学块(katex,带 LRU 渲染缓存) ── */

const MAX_CACHED_KATEX_RENDERS = 120;
const katexRenderCache = new Map<string, string | null>();

function readCachedKatexRender(cacheKey: string) {
  if (!katexRenderCache.has(cacheKey)) {
    return undefined;
  }
  const renderedHtml = katexRenderCache.get(cacheKey) ?? null;
  katexRenderCache.delete(cacheKey);
  katexRenderCache.set(cacheKey, renderedHtml);
  return renderedHtml;
}

function writeCachedKatexRender(cacheKey: string, renderedHtml: string | null) {
  katexRenderCache.delete(cacheKey);
  katexRenderCache.set(cacheKey, renderedHtml);
  while (katexRenderCache.size > MAX_CACHED_KATEX_RENDERS) {
    const oldestKey = katexRenderCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    katexRenderCache.delete(oldestKey);
  }
}

/* 不 memo(codemoss 同款)。职责:katex 资产就绪前的降级窗(```math 围栏
   先按代码块直渲)。katex 就绪后 rehype-katex 接管围栏节点,本组件自然卸载;
   null 不写缓存,避免把「未就绪」固化成永久降级。 */
export function FileMarkdownMathBlock({
  className,
  value,
}: {
  className?: string;
  value: string;
}) {
  const languageTag = extractLanguageTag(className);
  const renderCacheKey = `${languageTag ?? "math"}:${hashStableString(value)}`;
  const renderedHtml = useMemo(() => {
    const cachedRender = readCachedKatexRender(renderCacheKey);
    if (cachedRender !== undefined && cachedRender !== null) {
      return cachedRender;
    }
    const nextRender = renderLatexFormula(value);
    if (nextRender !== null) {
      writeCachedKatexRender(renderCacheKey, nextRender);
    }
    return nextRender;
  }, [renderCacheKey, value]);

  if (!renderedHtml) {
    return <FileMarkdownCodeBlock className={className} value={value} />;
  }

  return (
    <div
      className="fvp-file-markdown-math-block"
      data-language={languageTag ?? "math"}
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  );
}
