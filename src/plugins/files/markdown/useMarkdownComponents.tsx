/**
 * FileMarkdownPreview 块渲染件与 components 工厂 —— 自 FileMarkdownPreview.tsx 拆出
 * (文件规模铁则)。
 * BlockMarkdown:每 block 的 ReactMarkdown 包 memo(渐进揭示推进时父组件重渲染,
 * props 引用不变的已挂载块整体跳过重渲染与重解析);
 * useMarkdownComponents:a 链接受控分流(外链系统浏览器 / #锚点文档内滚动 /
 * 本地路径开文件 tab,webview 默认导航一律拦下)/ img 相对路径解析 + 点击全屏 /
 * pre 按语言分派(mermaid/math/Prism)/ table 横向滚动 —— 工厂结果按 blockKey
 * 缓存复用,保证 BlockMarkdown memo 的 components 引用稳定。
 */

import { memo, useCallback, useMemo, type MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { openExternalUrl } from "@kernel/ipc";
import { openFileInTab } from "../openFile";
import { t } from "@kernel/i18n";
import {
  extractLanguageTag,
  FileMarkdownCodeBlock,
  FileMarkdownMathBlock,
  FileMarkdownTableBlock,
  LazyMarkdownHeavyBlock,
} from "./markdownBlocks";
import { FileMarkdownMermaidBlock } from "./MermaidBlock";
import { LocalImage } from "./LocalImage";
import { resolveImageRenderSource, resolveMarkdownLinkTarget } from "./markdownImages";
import {
  createMermaidBlockKey,
  extractCodeFromPre,
  isHeavyCodeBlock,
  isMathCodeLanguage,
  isMermaidCodeLanguage,
  type PreviewPreNode,
} from "./markdownPreviewHelpers";

/* remark 插件数组提升为模块级常量:行内字面量会让每个 render 都拿到新数组
   引用,ReactMarkdown 视其为插件变化而增加不必要的重解析成本。 */
const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkMath];

type BlockMarkdownProps = {
  /** 块稳定 key(含内容 hash):仅作为 props 参与 memo 比较,组件内不直接消费。 */
  blockKey: string;
  markdown: string;
  rehypePlugins: Parameters<typeof ReactMarkdown>[0]["rehypePlugins"];
  components: Components;
};

export const BlockMarkdown = memo(function BlockMarkdown({
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

export function useMarkdownComponents({
  documentKey,
  progressive,
  sourceFilePath,
  onImageFullscreen,
  onAnchorNavigate,
}: {
  documentKey: string;
  progressive: boolean;
  sourceFilePath: string | null;
  onImageFullscreen: (image: { src: string; alt: string }) => void;
  /** `#锚点` 点击回调(锚点原文,未解码);缺省时锚点点击只拦不跳。 */
  onAnchorNavigate?: (anchor: string) => void;
}) {
  const handleAnchorClick = useCallback((event: MouseEvent, href?: string) => {
    if (!href) {
      return;
    }
    /* 任何带 href 的链接先拦下默认导航:webview 内相对/锚点导航会把整个应用
       页面带走(点击 md 内链「崩溃重启」的根因),所有分支只走受控打开路径。 */
    event.preventDefault();
    event.stopPropagation();
    const isExternal =
      href.startsWith("http://") ||
      href.startsWith("https://") ||
      href.startsWith("mailto:");
    if (isExternal) {
      /* 系统浏览器打开(浏览器 dev 回退 window.open,封装在 ipc 层)。 */
      void openExternalUrl(href);
      return;
    }
    if (href.startsWith("#")) {
      /* 文档内锚点:由预览层按标题匹配大纲条目滚动。 */
      onAnchorNavigate?.(href.slice(1));
      return;
    }
    /* 其余按本地文件路径处理(相对源文件解析)进文件 tab;非本地 scheme
       (javascript:/vscode: 等)解析返回 null,静默忽略。HTML <a> 经
       rehype-raw 同样落到本组件,天然同规则。 */
    const target = resolveMarkdownLinkTarget(href, sourceFilePath);
    if (target) {
      openFileInTab(target.path);
    }
  }, [onAnchorNavigate, sourceFilePath]);

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
            onImageFullscreen({
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
        label={t("表格")}
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
  }), [documentKey, handleAnchorClick, onImageFullscreen, progressive, sourceFilePath]);

  /* components 工厂结果按 blockKey 缓存复用:同一 block 在渐进揭示推进期间反复
     render 时拿到同一 components 引用,配合 BlockMarkdown memo 跳过重渲染。
     工厂闭包依赖任一变化 → createMarkdownComponents 标识变化 → Map 整体重建,
     即自动清缓存,不会串旧闭包。 */
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

  return { getBlockMarkdownComponents };
}
