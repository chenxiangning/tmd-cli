/**
 * markdown 块组件集 —— 照抄 codemoss FileMarkdownPreview 的块级渲染件。
 *
 * - FileMarkdownCodeBlock:语言 badge + Prism 高亮
 * - LazyMarkdownHeavyBlock:IntersectionObserver 600px 预揭示占位
 * - CodeBlockLanguageBadge / CodeBlockCopyButton:语言图标桶 + 复制按钮
 * (FileMarkdownMathBlock / FileMarkdownTableBlock 拆至 markdownTableMathBlocks,
 *  经底部 re-export 保持本文件导出契约)
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { BracketsCurly, Check, Code, Copy, FileCode, FileText, Hash, Gear, Sigma, Terminal, type Icon } from "@phosphor-icons/react";
import { highlightLine } from "./syntax";

/* ── 语言 badge(照抄 codemoss codeBlockLanguageIcon 的桶映射) ── */

const LANGUAGE_ICON_BUCKETS: Record<string, Icon> = {
  json: BracketsCurly,
  json5: BracketsCurly,
  jsonc: BracketsCurly,
  yaml: Gear,
  yml: Gear,
  toml: Gear,
  ini: Gear,
  properties: Gear,
  env: Gear,
  dotenv: Gear,
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

function getCodeBlockLanguageIcon(languageTag: string | null): Icon {
  if (!languageTag) {
    return Code;
  }
  return LANGUAGE_ICON_BUCKETS[languageTag.trim().toLowerCase()] ?? FileCode;
}

function CodeBlockLanguageBadge({
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

/** 复制按钮: Copy 图标,成功变 Check 1.2s。 */
function CodeBlockCopyButton({ value }: { value: string }) {
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

// 拆出后保持 ./markdownBlocks 导出契约(FileMarkdownPreview 的 import 面不变)。
export { FileMarkdownMathBlock, FileMarkdownTableBlock } from "./markdownTableMathBlocks";

