/**
 * md 正文渲染(react-markdown 按需拆包 chunk 的实体)——渲染规则与文件 md
 * 预览同源:remark-gfm(表格/任务列表/删除线)+ fvp-file-markdown /
 * fvp-markdown-github 全局样式(GitHub 排版,--tmd-* token 桥接)。
 * 与 files 管线的有意裁剪:无 katex/mermaid/本地图片解析/快路径(转录正文
 * 用不上;markdown-preview.css 经 global.css 全局引入,样式零复制)。
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/* 模块级常量:行内字面量会让每个 render 拿到新数组引用,ReactMarkdown 视为
   插件变化而增加重解析成本(files 同款纪律)。 */
const PLUGINS = [remarkGfm];

export function MarkdownBody({ children }: { children: string }) {
  return (
    <div className="fvp-file-markdown fvp-markdown-github sv-md">
      <ReactMarkdown remarkPlugins={PLUGINS}>{children}</ReactMarkdown>
    </div>
  );
}
