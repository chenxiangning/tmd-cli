/**
 * RPC 幕布 md 注入件 —— sessionTab 传 SsTurnView/LiveTurn 的 Markdown prop
 * 统一换装:正文先剥 omp 上下文标签(ssCtxTags.stripCtxTags)再交共享
 * MarkdownBody。用户块/思考节/答复块全走此件(注入点一处,渲染面全覆盖);
 * lazy 拆包语义同原 sessionTab 内联版(react-markdown 等重依赖仍按需拉 chunk)。
 */
import { lazy } from "react";
import { retryImport } from "@kernel/lazyImport";
import { stripCtxTags } from "./ssCtxTags";

const LazyMarkdownBody = lazy(retryImport(() =>
  import("@plugins/session-viewer/markdownBody").then((m) => ({ default: m.MarkdownBody })),
));

export function SsMarkdown({ children }: { children: string }) {
  return <LazyMarkdownBody>{stripCtxTags(children)}</LazyMarkdownBody>;
}
