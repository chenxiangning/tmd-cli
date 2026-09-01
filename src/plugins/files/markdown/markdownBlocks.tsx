/**
 * markdown 块组件集 —— 照抄 codemoss FileMarkdownPreview 的块级渲染件。
 *
 * - FileMarkdownCodeBlock:语言 badge + Prism 高亮
 * - FileMarkdownMathBlock:katex renderToString(带 LRU 缓存),失败降级代码块
 * - FileMarkdownTableBlock:横向滚动包裹 + scrollLeft 缓存
 * - LazyMarkdownHeavyBlock:IntersectionObserver 600px 预揭示占位
 * - CodeBlockLanguageBadge / CodeBlockCopyButton:语言图标桶 + 复制按钮
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type UIEvent,
} from "react";
import {
  Braces,
  Check,
  Code,
  Copy,
  FileCode,
  FileText,
  Hash,
  Settings2,
  Sigma,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { hashStableString } from "./markdownDocument";
import { renderLatexFormula } from "./markdownMath";
import { highlightLine } from "./syntax";

/* ── 语言 badge(照抄 codemoss codeBlockLanguageIcon 的桶映射) ── */

const LANGUAGE_ICON_BUCKETS: Record<string, LucideIcon> = {
  json: Braces,
  json5: Braces,
  jsonc: Braces,
  yaml: Settings2,
  yml: Settings2,
  toml: Settings2,
  ini: Settings2,
  properties: Settings2,
  env: Settings2,
  dotenv: Settings2,
  bash: Terminal,
  sh: Terminal,
  shell: Terminal,
  zsh: Terminal,
  console: Terminal,
  powershell: Terminal,
  ps1: Terminal,
  dockerfile: Terminal,
  markdown: FileText,
  md: FileText,
  mdx: FileText,
  text: FileText,
  plaintext: FileText,
  diff: FileText,
  latex: Sigma,
  tex: Sigma,
  math: Sigma,
  css: Hash,
  scss: Hash,
  sass: Hash,
  less: Hash,
};

export function getCodeBlockLanguageIcon(languageTag: string | null): LucideIcon {
  if (!languageTag) {
    return Code;
  }
  return LANGUAGE_ICON_BUCKETS[languageTag.trim().toLowerCase()] ?? FileCode;
}

export function CodeBlockLanguageBadge({
  languageTag,
  label,
  title,
}: {
  languageTag: string | null;
  label: string;
  title?: string;
}) {
  const Icon = getCodeBlockLanguageIcon(languageTag);
  return (
    <span className="markdown-codeblock-language" title={title}>
      <Icon className="markdown-codeblock-language-icon" aria-hidden="true" />
      <span className="markdown-codeblock-language-text">{label}</span>
    </span>
  );
}

/** 复制按钮:Copy 图标,成功变 Check 1.2s。 */
export function CodeBlockCopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(true);
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      className={`ghost markdown-codeblock-copy${copied ? " is-copied" : ""}`}
      onClick={handleCopy}
      aria-label="复制代码"
      title={copied ? "已复制" : "复制"}
    >
      {copied ? (
        <Check className="markdown-codeblock-copy-icon" aria-hidden="true" />
      ) : (
        <Copy className="markdown-codeblock-copy-icon" aria-hidden="true" />
      )}
    </button>
  );
}

/* ── 代码块 ── */

export function extractLanguageTag(className?: string) {
  if (!className) {
    return null;
  }
  const match = className.match(/language-([\w-]+)/i);
  return match?.[1] ?? null;
}

export function FileMarkdownCodeBlock({
  className,
  value,
}: {
  className?: string;
  value: string;
}) {
  const languageTag = extractLanguageTag(className);
  const highlightedHtml = useMemo(
    () => highlightLine(value, languageTag),
    [languageTag, value],
  );

  return (
    <div className="fvp-file-markdown-codeblock">
      <div className="fvp-file-markdown-codeblock-label">
        <CodeBlockLanguageBadge
          languageTag={languageTag}
          label={languageTag ?? "Code"}
        />
        <CodeBlockCopyButton value={value} />
      </div>
      <pre>
        <code
          className={className}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      </pre>
    </div>
  );
}

/* ── 重块懒揭示(IntersectionObserver 600px 预载) ── */

const MAX_REVEALED_HEAVY_BLOCKS = 800;
const revealedHeavyBlockCache = new Set<string>();

function markHeavyBlockRevealed(revealKey: string | null) {
  if (!revealKey) {
    return;
  }
  revealedHeavyBlockCache.delete(revealKey);
  revealedHeavyBlockCache.add(revealKey);
  while (revealedHeavyBlockCache.size > MAX_REVEALED_HEAVY_BLOCKS) {
    const oldestKey = revealedHeavyBlockCache.values().next().value;
    if (!oldestKey) {
      break;
    }
    revealedHeavyBlockCache.delete(oldestKey);
  }
}

function isHeavyBlockRevealed(revealKey: string | null) {
  return Boolean(revealKey && revealedHeavyBlockCache.has(revealKey));
}

export function LazyMarkdownHeavyBlock({
  children,
  defer,
  label,
  revealKey = null,
}: {
  children: ReactNode;
  defer: boolean;
  label: string;
  revealKey?: string | null;
}) {
  const [isVisible, setIsVisible] = useState(() => !defer || isHeavyBlockRevealed(revealKey));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const revealBlock = useCallback(() => {
    markHeavyBlockRevealed(revealKey);
    setIsVisible(true);
  }, [revealKey]);

  useEffect(() => {
    if (isVisible) {
      markHeavyBlockRevealed(revealKey);
    }
  }, [isVisible, revealKey]);

  useEffect(() => {
    if (defer && isHeavyBlockRevealed(revealKey)) {
      setIsVisible(true);
    }
  }, [defer, revealKey]);

  useEffect(() => {
    if (!defer || isVisible) {
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      const timeoutId = window.setTimeout(revealBlock, 0);
      return () => window.clearTimeout(timeoutId);
    }
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        revealBlock();
        observer.disconnect();
      }
    }, {
      rootMargin: "600px 0px",
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [defer, isVisible, revealBlock]);

  if (isVisible) {
    return <>{children}</>;
  }

  return (
    <div
      ref={rootRef}
      className="fvp-file-markdown-heavy-placeholder"
      data-testid="file-markdown-heavy-placeholder"
      aria-label={label}
    >
      加载中…
    </div>
  );
}

/* ── 表格块(横向滚动 + scrollLeft 缓存) ── */

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
