/**
 * md 正文渲染(react-markdown 按需拆包 chunk 的实体)——渲染规则与文件 md
 * 预览同源:remark-gfm(表格/任务列表/删除线)+ fvp-file-markdown /
 * fvp-markdown-github 全局样式(GitHub 排版,--tmd-* token 桥接)。
 * mermaid 栅栏复用 files 管线的 FileMarkdownMermaidBlock(源码/渲染双 tab、
 * 主题跟随、SVG LRU、全屏;mermaid 库切到渲染 tab 才懒加载)。仍有意裁剪:
 * 无 katex/本地图片解析/快路径(转录正文用不上)。
 */
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
/* 跨插件 UI 复用先例:样式既已同源(fvp-* 全局类),mermaid 块组件级复用
   免立第二条渲染管线;纯 props 组件,不涉 files 插件生命周期。 */
import { FileMarkdownMermaidBlock } from "@plugins/files/markdown/MermaidBlock";
import { extractLanguageTag } from "@plugins/files/markdown/languageTag";
import {
  createMermaidBlockKey,
  extractCodeFromPre,
  isMermaidCodeLanguage,
  type PreviewPreNode,
} from "@plugins/files/markdown/markdownPreviewHelpers";

/* 模块级常量:行内字面量会让每个 render 拿到新数组引用,ReactMarkdown 视为
   插件变化而增加重解析成本(files 同款纪律)。 */
const PLUGINS = [remarkGfm];

/* 转录无文档级身份,统一命名空间即可:mermaid 缓存键含内容哈希,跨会话
   同图共享 SVG 与 tab 选择,无串扰面。 */
const MERMAID_DOCUMENT_KEY = "session-viewer";

const COMPONENTS: Components = {
  pre: ({ node, children }) => {
    const { className, value } = extractCodeFromPre(node as PreviewPreNode);
    if (value && isMermaidCodeLanguage(extractLanguageTag(className))) {
      return (
        <FileMarkdownMermaidBlock
          blockKey={createMermaidBlockKey(node, value, 1)}
          className={className}
          documentKey={MERMAID_DOCUMENT_KEY}
          value={value}
        />
      );
    }
    return <pre>{children}</pre>;
  },
};

export function MarkdownBody({ children }: { children: string }) {
  return (
    <div className="fvp-file-markdown fvp-markdown-github sv-md">
      <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS}>{children}</ReactMarkdown>
    </div>
  );
}
