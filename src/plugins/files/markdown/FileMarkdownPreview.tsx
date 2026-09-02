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
import type { Element } from "hast";
import { openExternalUrl } from "@kernel/ipc";
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
import { PreviewOutlineSidebar } from "./PreviewOutlineSidebar";
import { useMarkdownOutline } from "./useMarkdownOutline";
import { resolveImageRenderSource } from "./markdownImages";

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

/* remark 插件数组提升为模块级常量:行内字面量会让每个 render 都拿到新数组
   引用,ReactMarkdown 视其为插件变化而增加不必要的重解析成本。 */
const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkMath];

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

type BlockMarkdownProps = {
  /** 块稳定 key(含内容 hash):仅作为 props 参与 memo 比较,组件内不直接消费。 */
  blockKey: string;
  markdown: string;
  rehypePlugins: Parameters<typeof ReactMarkdown>[0]["rehypePlugins"];
  components: Components;
};

/* 每 block 的 ReactMarkdown 包一层 memo:渐进揭示推进时 visibleLineLimit 每 16ms
   变一次、父组件随之重渲染,已挂载块只要 props(markdown/rehypePlugins/components)
   引用不变就整体跳过重渲染与重解析。components 引用稳定性由下方
   markdownComponentsByBlockKey 缓存保证。 */
const BlockMarkdown = memo(function BlockMarkdown({
  markdown,
  rehypePlugins,
  components,
}: BlockMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={MARKDOWN_REMARK_PLUGINS}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {markdown}
    </ReactMarkdown>
  );
});

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

  /* ── 章节大纲浮窗(状态机照抄 codemoss Router,实现在 useMarkdownOutline) ── */
  const {
    outline,
    previewRootRef,
    activeOutlineItemId,
    isOutlinePinned,
    isOutlineCollapsed,
    handleSelectOutlineItem,
    handleToggleOutlinePinned,
    handleToggleOutlineCollapsed,
    handleOutlineMouseLeave,
  } = useMarkdownOutline({
    body: compiledDocument.body,
    cacheKey: compiledDocument.cacheKey,
    visibleLineLimit,
  });

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
    /* 系统浏览器打开(浏览器 dev 回退 window.open,封装在 ipc 层)。 */
    void openExternalUrl(href);
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
            revealKey={`${documentKey}:${blockKey}:${languageTag ?? "math"}`}
          >
            <FileMarkdownMathBlock className={codeClassName} value={codeValue} />
          </LazyMarkdownHeavyBlock>
        );
      }
      return (
        <LazyMarkdownHeavyBlock
          defer={progressive && isHeavyCodeBlock(codeValue)}
          label={languageTag ?? "code"}
          revealKey={`${documentKey}:${blockKey}:${languageTag ?? "code"}`}
        >
          <FileMarkdownCodeBlock className={codeClassName} value={codeValue} />
        </LazyMarkdownHeavyBlock>
      );
    },
  }), [documentKey, handleAnchorClick, progressive, sourceFilePath]);

  /* components 工厂结果按 blockKey 缓存复用:同一 block 在渐进揭示推进期间反复
     render 时拿到同一 components 引用,配合 BlockMarkdown memo 跳过重渲染。
     工厂闭包依赖(documentKey/handleAnchorClick/progressive/sourceFilePath)任一变化
     → createMarkdownComponents 标识变化 → Map 整体重建,即自动清缓存,不会串旧闭包。 */
  const markdownComponentsByBlockKey = useMemo(
    () => new Map<string, Components>(),
    [createMarkdownComponents],
  );
  const getBlockMarkdownComponents = useCallback(
    (blockStartLine: number, blockKey: string): Components => {
      const cachedComponents = markdownComponentsByBlockKey.get(blockKey);
      if (cachedComponents) {
        return cachedComponents;
      }
      const components = createMarkdownComponents(blockStartLine, blockKey);
      markdownComponentsByBlockKey.set(blockKey, components);
      return components;
    },
    [createMarkdownComponents, markdownComponentsByBlockKey],
  );

  return (
    <div className="fvp-markdown-preview-frame">
      {outline.length > 0 && (
        <div className="fvp-markdown-outline-layer">
          <PreviewOutlineSidebar
            items={outline}
            activeItemId={activeOutlineItemId}
            onSelectItem={handleSelectOutlineItem}
            collapsed={isOutlineCollapsed}
            pinned={isOutlinePinned}
            onToggleCollapsed={handleToggleOutlineCollapsed}
            onTogglePinned={handleToggleOutlinePinned}
            onMouseLeave={handleOutlineMouseLeave}
          />
        </div>
      )}
      <div ref={previewRootRef} className="fvp-markdown-preview-scroll">
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
            <BlockMarkdown
              key={block.key}
              blockKey={block.key}
              markdown={block.markdown}
              rehypePlugins={rehypePlugins}
              components={getBlockMarkdownComponents(block.startLine, block.key)}
            />
          ))}
        </div>
      </div>
    </div>
  );
});
