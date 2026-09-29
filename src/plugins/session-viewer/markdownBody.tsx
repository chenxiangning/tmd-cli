/**
 * md 正文渲染(react-markdown 按需拆包 chunk 的实体)——渲染规则与文件 md
 * 预览同源:remark-gfm(表格/任务列表/删除线)+ remark-math($/$$ 定界)+
 * fvp-file-markdown / fvp-markdown-github 全局样式(GitHub 排版,--tmd-* token
 * 桥接)。mermaid 栅栏复用 files 管线的 FileMarkdownMermaidBlock(源码/渲染
 * 双 tab、主题跟随、SVG LRU、全屏;mermaid 库切到渲染 tab 才懒加载)。
 * 数学复用同管线:katex 资产按需懒加载,就绪前 ```math 栅栏降级代码块直渲,
 * 就绪后 rehype-katex 接管 $/$$/栅栏节点(FileMarkdownMathBlock 自然卸载)。
 * 仍有意裁剪:无本地图片解析/快路径(转录正文用不上)。
 */
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
/* 跨插件 UI 复用先例:样式既已同源(fvp-* 全局类),mermaid/数学块组件级复用
   免立第二条渲染管线;纯 props 组件,不涉 files 插件生命周期。 */
import { FileMarkdownMermaidBlock } from "@plugins/files/markdown/MermaidBlock";
import { FileMarkdownMathBlock } from "@plugins/files/markdown/markdownTableMathBlocks";
import { extractLanguageTag } from "@plugins/files/markdown/languageTag";
import {
  areKatexAssetsReady,
  detectMathContent,
  getCachedRehypeKatex,
  loadKatexAssets,
} from "@plugins/files/markdown/markdownMath";
import {
  createMermaidBlockKey,
  extractCodeFromPre,
  isMathCodeLanguage,
  isMermaidCodeLanguage,
  type PreviewPreNode,
} from "@plugins/files/markdown/markdownPreviewHelpers";

/* 模块级常量:行内字面量会让每个 render 拿到新数组引用,ReactMarkdown 视为
   插件变化而增加重解析成本(files 同款纪律)。 */
const PLUGINS = [remarkGfm, remarkMath];
const EMPTY_REHYPE: Parameters<typeof ReactMarkdown>[0]["rehypePlugins"] = [];

/* 转录无文档级身份,统一命名空间即可:mermaid 缓存键含内容哈希,跨会话
   同图共享 SVG 与 tab 选择,无串扰面。 */
const MERMAID_DOCUMENT_KEY = "session-viewer";

const COMPONENTS: Components = {
  pre: ({ node, children }) => {
    const { className, value } = extractCodeFromPre(node as PreviewPreNode);
    if (!value) {
      return <pre>{children}</pre>;
    }
    const languageTag = extractLanguageTag(className);
    if (isMermaidCodeLanguage(languageTag)) {
      return (
        <FileMarkdownMermaidBlock
          blockKey={createMermaidBlockKey(node, value, 1)}
          className={className}
          documentKey={MERMAID_DOCUMENT_KEY}
          value={value}
        />
      );
    }
    if (isMathCodeLanguage(languageTag)) {
      /* katex 资产就绪前的降级窗(代码块直渲);就绪后 rehype-katex 接管,
         本分支不再命中(files 预览同款时序)。 */
      return <FileMarkdownMathBlock className={className} value={value} />;
    }
    return <pre>{children}</pre>;
  },
};

export function MarkdownBody({ children }: { children: string }) {
  const [katexReady, setKatexReady] = useState(() => areKatexAssetsReady());
  const hasMathContent = useMemo(() => detectMathContent(children), [children]);

  useEffect(() => {
    if (!hasMathContent || katexReady) return;
    let cancelled = false;
    void loadKatexAssets().then(() => {
      if (!cancelled) setKatexReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [hasMathContent, katexReady]);

  /* rehype-katex 输出为 katex 生成的受限节点结构,不经 sanitize(与 files
     管线同序:katex 产物信任);数组引用仅在就绪边沿变化一次。 */
  const rehypePlugins = useMemo(() => {
    const rehypeKatex = katexReady ? getCachedRehypeKatex() : null;
    return rehypeKatex ? ([rehypeKatex] as NonNullable<Parameters<typeof ReactMarkdown>[0]["rehypePlugins"]>) : EMPTY_REHYPE;
  }, [katexReady]);

  return (
    <div className="fvp-file-markdown fvp-markdown-github sv-md">
      <ReactMarkdown remarkPlugins={PLUGINS} rehypePlugins={rehypePlugins} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
