/**
 * markdown 文件预览 —— 照抄 codemoss FileMarkdownPreviewRich。
 *
 * 管线:compileFileMarkdownDocument(frontmatter+切块)
 *   → 每 block 一个 ReactMarkdown(remark-gfm + remark-math)
 *   → rehype-raw → rehype-sanitize(扩展 schema)→ 条件 rehype-katex(懒加载)
 *   → 自定义 components:a 外链走系统浏览器 / img 相对路径转 asset:// + 点击全屏 /
 *     pre 按语言分派(mermaid 双 tab、math 走 katex、其余 Prism 高亮)/ table 横向滚动
 *
 * 与 codemoss 的差异(有意裁剪):无批注系统、无 i18n、无 Worker 快路径、
 * 无大纲侧边栏;渐进渲染保留(大文件分片揭示),bounded 投影不保留。
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Element } from "hast";
import {
  compileFileMarkdownDocument,
  hashStableString,
} from "./markdownDocument";
import {
  areKatexAssetsReady,
  detectMathContent,
  getCachedRehypeKatex,
  loadKatexAssets,
} from "./markdownMath";
import { LocalImage } from "./LocalImage";
import { ImageFullscreenViewer } from "./ImageFullscreenViewer";
import {
  extractLanguageTag,
  FileMarkdownCodeBlock,
  FileMarkdownMathBlock,
  FileMarkdownTableBlock,
  LazyMarkdownHeavyBlock,
} from "./markdownBlocks";
import { FileMarkdownMermaidBlock } from "./MermaidBlock";

type PreviewPreNode = {
  children?: Array<{
    tagName?: string;
    properties?: { className?: string[] | string };
    children?: Array<{ value?: string }>;
  }>;
};

type MarkdownPositionTreeNode = Element | undefined;

const PROGRESSIVE_INITIAL_LINES = 360;
const PROGRESSIVE_CHUNK_LINES = 720;
const HEAVY_CODE_BLOCK_LINE_THRESHOLD = 80;
const HEAVY_CODE_BLOCK_BYTE_THRESHOLD = 12_000;
const FILE_MARKDOWN_IMAGE_EXTENSION_REGEX =
  /\.(?:apng|avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
const BROWSER_LOADABLE_IMAGE_SRC_REGEX = /^(?:https?:|data:|blob:|asset:)/i;

function safeDecodeMarkdownImageSrc(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripMarkdownImageDecorators(value: string) {
  return safeDecodeMarkdownImageSrc(
    value
      .trim()
      .replace(/^<(.+)>$/, "$1")
      .replace(/^['"](.+)['"]$/, "$1")
      .trim(),
  );
}

function removeUrlSuffix(value: string) {
  const suffixIndex = value.search(/[?#]/);
  return suffixIndex >= 0 ? value.slice(0, suffixIndex) : value;
}

function dirname(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(0, slashIndex) : "";
}

function normalizePathSegments(path: string) {
  const isAbsolute = path.startsWith("/");
  const segments = path.replace(/\\/g, "/").split("/");
  const resolvedSegments: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (resolvedSegments.length > 0 && resolvedSegments[resolvedSegments.length - 1] !== "..") {
        resolvedSegments.pop();
      } else if (!isAbsolute) {
        resolvedSegments.push(segment);
      }
      continue;
    }
    resolvedSegments.push(segment);
  }
  return `${isAbsolute ? "/" : ""}${resolvedSegments.join("/")}`;
}

function resolveLocalImagePath(src: string, sourceFilePath?: string | null) {
  const cleaned = stripMarkdownImageDecorators(src);
  if (!cleaned || BROWSER_LOADABLE_IMAGE_SRC_REGEX.test(cleaned)) {
    return null;
  }

  const pathOnly = removeUrlSuffix(cleaned);
  if (!pathOnly || !FILE_MARKDOWN_IMAGE_EXTENSION_REGEX.test(pathOnly)) {
    return null;
  }

  if (pathOnly.startsWith("file://")) {
    const withoutScheme = pathOnly.slice("file://".length);
    const withoutHost = withoutScheme.startsWith("localhost/")
      ? withoutScheme.slice("localhost/".length)
      : withoutScheme;
    return withoutHost.startsWith("/") ? withoutHost : `/${withoutHost}`;
  }

  if (
    pathOnly.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(pathOnly) ||
    /^\\\\[^\\]/.test(pathOnly)
  ) {
    return pathOnly;
  }

  const sourceDir = sourceFilePath ? dirname(sourceFilePath) : "";
  return normalizePathSegments(sourceDir ? `${sourceDir}/${pathOnly}` : pathOnly);
}

function resolveImageRenderSource(src: string, sourceFilePath?: string | null) {
  const cleaned = stripMarkdownImageDecorators(src);
  const localPath = resolveLocalImagePath(cleaned, sourceFilePath);
  if (!localPath) {
    return { src: cleaned, localPath: null };
  }
  try {
    return { src: convertFileSrc(localPath), localPath };
  } catch {
    return { src: cleaned, localPath };
  }
}

function extractCodeFromPre(node?: PreviewPreNode) {
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

function isMermaidCodeLanguage(languageTag: string | null) {
  return languageTag === "mermaid" || languageTag === "flowchart";
}

function isMathCodeLanguage(languageTag: string | null) {
  return languageTag === "math" || languageTag === "latex" || languageTag === "tex";
}

function isHeavyCodeBlock(value: string) {
  return (
    value.length > HEAVY_CODE_BLOCK_BYTE_THRESHOLD ||
    value.split(/\r?\n/).length > HEAVY_CODE_BLOCK_LINE_THRESHOLD
  );
}

function hasDocumentScopedMarkdownFeatures(value: string) {
  return (
    /^\s{0,3}\[[^\]\n]+]:\s+\S+/m.test(value) ||
    /^\s{0,3}<([A-Za-z][\w:-]*)(?:\s[^>]*)?>[\s\S]*?^\s{0,3}<\/\1>\s*$/m.test(value)
  );
}

function createMermaidBlockKey(
  node: MarkdownPositionTreeNode,
  value: string,
  blockStartLine: number,
): string {
  const startLine = (node?.position?.start.line ?? 1) + blockStartLine - 1;
  const endLine = (node?.position?.end.line ?? 1) + blockStartLine - 1;
  return `${startLine}:${endLine}:${hashStableString(value)}`;
}

export const FileMarkdownPreview = memo(function FileMarkdownPreview({
  value,
  sourceFilePath = null,
  className = "fvp-file-markdown fvp-markdown-github",
}: {
  value: string;
  /** 所在 md 文件绝对路径:相对路径图片以其 dirname 解析。 */
  sourceFilePath?: string | null;
  className?: string;
}) {
  const documentKey = useMemo(
    () => `file:${sourceFilePath ?? `inline:${hashStableString(value)}`}`,
    [sourceFilePath, value],
  );
  const compiledDocument = useMemo(
    () => compileFileMarkdownDocument(documentKey, value),
    [documentKey, value],
  );
  const bodyLineCount = useMemo(
    () => (compiledDocument.body.length === 0 ? 0 : compiledDocument.body.split(/\r?\n/).length),
    [compiledDocument.body],
  );
  const progressive = compiledDocument.renderStrategy === "progressive";
  const [visibleLineLimit, setVisibleLineLimit] = useState(
    progressive ? Math.min(PROGRESSIVE_INITIAL_LINES, bodyLineCount) : bodyLineCount,
  );
  useEffect(() => {
    setVisibleLineLimit(
      progressive ? Math.min(PROGRESSIVE_INITIAL_LINES, bodyLineCount) : bodyLineCount,
    );
  }, [compiledDocument.cacheKey, progressive, bodyLineCount]);

  /* 渐进揭示:大文档分片渲染,避免单帧巨量 React commit。 */
  useEffect(() => {
    if (!progressive || visibleLineLimit >= bodyLineCount) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setVisibleLineLimit((current) =>
        Math.min(current + PROGRESSIVE_CHUNK_LINES, bodyLineCount),
      );
    }, 16);
    return () => window.clearTimeout(timeoutId);
  }, [progressive, visibleLineLimit, bodyLineCount]);

  const shouldRenderSingleMarkdownDocument = useMemo(
    () => !progressive && hasDocumentScopedMarkdownFeatures(compiledDocument.body),
    [compiledDocument.body, progressive],
  );
  const renderBlocks = useMemo(
    () =>
      shouldRenderSingleMarkdownDocument
        ? [{
            key: `${compiledDocument.cacheKey}:full`,
            markdown: compiledDocument.body,
            startLine: 1,
            endLine: bodyLineCount,
          }]
        : compiledDocument.blocks,
    [
      compiledDocument.blocks,
      compiledDocument.body,
      compiledDocument.cacheKey,
      bodyLineCount,
      shouldRenderSingleMarkdownDocument,
    ],
  );
  const visibleMarkdownBlocks = useMemo(
    () => renderBlocks.filter((block) => block.startLine <= visibleLineLimit),
    [visibleLineLimit, renderBlocks],
  );

  const [imageFullscreen, setImageFullscreen] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  const hasMathContent = useMemo(() => detectMathContent(value), [value]);
  const [katexReady, setKatexReady] = useState(() => areKatexAssetsReady());
  useEffect(() => {
    if (!hasMathContent || katexReady) {
      return;
    }
    let cancelled = false;
    void loadKatexAssets().then(() => {
      if (!cancelled) {
        setKatexReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hasMathContent, katexReady]);

  const rehypePlugins = useMemo(() => {
    const plugins: unknown[] = [
      rehypeRaw,
      [rehypeSanitize, {
        ...defaultSchema,
        tagNames: [
          ...(defaultSchema.tagNames ?? []),
          "details", "summary", "abbr", "mark", "ins", "del",
          "sub", "sup", "kbd", "var", "samp",
        ],
        attributes: {
          ...defaultSchema.attributes,
          "*": [...(defaultSchema.attributes?.["*"] ?? []), "className", "class"],
        },
      }],
    ];
    const cachedRehypeKatex = getCachedRehypeKatex();
    if (katexReady && cachedRehypeKatex) {
      plugins.push(cachedRehypeKatex);
    }
    return plugins as Parameters<typeof ReactMarkdown>[0]["rehypePlugins"];
  }, [katexReady]);

  const handleAnchorClick = useCallback((event: MouseEvent, href?: string) => {
    if (!href) {
      return;
    }
    const isExternal =
      href.startsWith("http://") ||
      href.startsWith("https://") ||
      href.startsWith("mailto:");
    if (!isExternal) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void openUrl(href).catch(() => {
      // 浏览器 dev 无 opener 插件:回退新窗口打开。
      window.open(href, "_blank", "noopener,noreferrer");
    });
  }, []);

  const createMarkdownComponents = useCallback((blockStartLine: number, blockKey: string): Components => ({
    a: ({ href, children, node: _node, ...props }) => (
      <a {...props} href={href} onClick={(event) => handleAnchorClick(event, href)}>
        {children}
      </a>
    ),
    img: ({ src, alt, height, node: _node, width, ...props }) => {
      const resolvedImage = resolveImageRenderSource(
        typeof src === "string" ? src : "",
        sourceFilePath,
      );
      if (!resolvedImage.src) {
        return null;
      }
      return (
        <LocalImage
          {...props}
          src={resolvedImage.src}
          localPath={resolvedImage.localPath}
          alt={typeof alt === "string" ? alt : "image"}
          height={height}
          loading="lazy"
          width={width}
          onClick={() =>
            setImageFullscreen({
              src: resolvedImage.localPath ?? resolvedImage.src,
              alt: alt ?? "image",
            })
          }
        />
      );
    },
    table: ({ node, children }) => (
      <FileMarkdownTableBlock
        defer={progressive}
        label="表格"
        revealKey={`${documentKey}:${blockKey}:table:${node?.position?.start.line ?? 0}`}
        scrollCacheKey={`${documentKey}:${blockKey}:table-scroll:${node?.position?.start.line ?? 0}`}
      >
        {children}
      </FileMarkdownTableBlock>
    ),
    pre: ({ node, children }) => {
      const { className: codeClassName, value: codeValue } = extractCodeFromPre(
        node as PreviewPreNode,
      );
      if (!codeClassName && !codeValue) {
        return <pre>{children}</pre>;
      }
      const languageTag = extractLanguageTag(codeClassName);
      if (isMermaidCodeLanguage(languageTag)) {
        const mermaidBlockKey = createMermaidBlockKey(node, codeValue, blockStartLine);
        return (
          <LazyMarkdownHeavyBlock
            defer={progressive}
            label={languageTag ?? "mermaid"}
            revealKey={`${documentKey}:${mermaidBlockKey}:${languageTag ?? "mermaid"}`}
          >
            <FileMarkdownMermaidBlock
              blockKey={mermaidBlockKey}
              className={codeClassName}
              documentKey={documentKey}
              value={codeValue}
            />
          </LazyMarkdownHeavyBlock>
        );
      }
      if (isMathCodeLanguage(languageTag)) {
        return (
          <LazyMarkdownHeavyBlock
            defer={progressive}
            label={languageTag ?? "math"}
            revealKey={`${documentKey}:${blockKey}:${languageTag ?? "math"}:${hashStableString(codeValue)}`}
          >
            <FileMarkdownMathBlock className={codeClassName} value={codeValue} />
          </LazyMarkdownHeavyBlock>
        );
      }
      return (
        <LazyMarkdownHeavyBlock
          defer={progressive && isHeavyCodeBlock(codeValue)}
          label={languageTag ?? "code"}
          revealKey={`${documentKey}:${blockKey}:${languageTag ?? "code"}:${hashStableString(codeValue)}`}
        >
          <FileMarkdownCodeBlock className={codeClassName} value={codeValue} />
        </LazyMarkdownHeavyBlock>
      );
    },
  }), [documentKey, handleAnchorClick, progressive, sourceFilePath]);

  return (
    <div
      className={className}
      data-markdown-render-strategy={compiledDocument.renderStrategy}
      data-testid="file-markdown-preview"
    >
      <ImageFullscreenViewer
        open={!!imageFullscreen}
        src={imageFullscreen?.src ?? ""}
        alt={imageFullscreen?.alt}
        onClose={() => setImageFullscreen(null)}
      />
      {compiledDocument.frontmatterFields.length > 0 ? (
        <section className="fvp-file-markdown-frontmatter" data-testid="file-markdown-frontmatter">
          <div className="fvp-file-markdown-frontmatter-label">Frontmatter</div>
          <dl className="fvp-file-markdown-frontmatter-grid">
            {compiledDocument.frontmatterFields.map((field) => (
              <div key={field.key} className="fvp-file-markdown-frontmatter-row">
                <dt>{field.key}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {visibleMarkdownBlocks.map((block) => (
        <ReactMarkdown
          key={block.key}
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={rehypePlugins}
          components={createMarkdownComponents(block.startLine, block.key)}
        >
          {block.markdown}
        </ReactMarkdown>
      ))}
    </div>
  );
});
