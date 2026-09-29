/**
 * grok 会话转录行型 —— ~/.grok/sessions/<enc(cwd)>/<uuid>/chat_history.jsonl
 * 私有格式,行循环复用 cli-shared/sessionTranscript 骨架。
 *
 * 行型实证(2026-09-28 本机采样):{type:"user",content:[parts]}(真实输入
 * 包裹 <user_query>,与锚点栏同源提取)、{type:"assistant",content:"正文",
 * model_id}、{type:"reasoning",summary:[{type:"summary_text",text}]}、
 * {type:"system"}(跳过)。工具调用行本机未实证 → 按「宁漏勿误」跳过,
 * 实证后补齐(grokUserMessageLine 同款纪律)。
 * 行无 uuid:id 用内容 FNV-1a hash(同锚点栏降级口径)。
 */

import type { CliTranscriptBlock } from "@kernel/cli";
import type { TranscriptLineParser } from "../cli-shared/sessionTranscript";
import { fnv1a32, grokUserQueryText } from "../cli-shared/userMessages";

/** reasoning 行 summary[].summary_text → 文本。 */
function grokSummaryText(summary: unknown): string | undefined {
  if (!Array.isArray(summary)) return undefined;
  const parts: string[] = [];
  for (const item of summary) {
    if (!item || typeof item !== "object") continue;
    const text = (item as Record<string, unknown>).text;
    if (typeof text === "string" && text.trim()) parts.push(text);
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

/** grok 行解析器(纯函数,可测)。 */
export const grokTranscriptLine: TranscriptLineParser = (event) => {
  const blocks: CliTranscriptBlock[] = [];
  if (event.type === "user") {
    const text = grokUserQueryText(event.content);
    if (text) blocks.push({ id: `u:${fnv1a32(text)}`, role: "user", text });
    return blocks;
  }
  if (event.type === "assistant") {
    const content = event.content;
    if (typeof content === "string" && content.trim()) {
      blocks.push({ id: `a:${fnv1a32(content)}`, role: "assistant", text: content });
    }
    return blocks;
  }
  if (event.type === "reasoning") {
    const text = grokSummaryText(event.summary);
    if (text) blocks.push({ id: `r:${fnv1a32(text)}`, role: "reasoning", text });
  }
  return blocks;
};
