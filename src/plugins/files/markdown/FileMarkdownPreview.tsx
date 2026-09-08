/**
 * markdown 文件预览 —— 照抄 codemoss FileMarkdownPreviewRich。
 *
 * 管线:compileFileMarkdownDocument(frontmatter+切块)
 *   → 每 block 一个 ReactMarkdown(remark-gfm + remark-math)
 *   → rehype-raw → rehype-sanitize(扩展 schema)→ 条件 rehype-katex(懒加载)
 *   → 自定义 components(a 外链 / img 本地解析 / pre 语言分派 / table,工厂与
 *     BlockMarkdown 见 useMarkdownComponents,纯函数助手见 markdownPreviewHelpers)
 *
 * 与 codemoss 的差异(有意裁剪):无批注系统、无 i18n、无 Worker 快路径、
 * 无大纲侧边栏;渐进渲染保留(大文件分片揭示),bounded 投影不保留。
 */

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
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
import { ImageFullscreenViewer } from "./ImageFullscreenViewer";
import { PreviewOutlineSidebar } from "./PreviewOutlineSidebar";
import { useMarkdownOutline } from "./useMarkdownOutline";
import { hasDocumentScopedMarkdownFeatures, normalizeMarkdownAnchorKey } from "./markdownPreviewHelpers";
import { BlockMarkdown, useMarkdownComponents } from "./useMarkdownComponents";
import { flattenPreviewOutlineItems } from "./outline";

const PROGRESSIVE_INITIAL_LINES = 360;
const PROGRESSIVE_CHUNK_LINES = 720;

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

  const handleAnchorNavigate = useCallback(
    (anchor: string) => {
      if (!anchor) {
        return;
      }
      /* 站内锚点按标题宽松匹配大纲条目,复用大纲点击的滚动与渐进兜底。 */
      const anchorKey = normalizeMarkdownAnchorKey(anchor);
      const item = flattenPreviewOutlineItems(outline).find(
        (outlineItem) => normalizeMarkdownAnchorKey(outlineItem.title) === anchorKey,
      );
      if (item) {
        handleSelectOutlineItem(item);
      }
    },
    [outline, handleSelectOutlineItem],
  );

  const { getBlockMarkdownComponents } = useMarkdownComponents({
    documentKey,
    progressive,
    sourceFilePath,
    onImageFullscreen: setImageFullscreen,
    onAnchorNavigate: handleAnchorNavigate,
  });

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
