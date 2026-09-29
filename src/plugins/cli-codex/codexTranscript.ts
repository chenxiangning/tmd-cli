/**
 * codex 会话转录行型 —— ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl 私有格式,
 * 行循环/配对复用 cli-shared/sessionTranscript 骨架(消费先例:claude 族/pi 族)。
 *
 * 行型实证(2026-09-28 本机采样):
 * - {type:"response_item",timestamp,payload:{type:"message",role,content:
 *   [{type:"input_text"|"output_text",text}]}}:role=user 真实输入(滤包装)、
 *   assistant 输出;role=developer 是注入行,跳过。
 * - payload function_call{name,arguments(JSON 字符串,exec_command 形如
 *   {"cmd":…}),call_id} → 工具块;function_call_output{call_id,output} → 结果块。
 * - payload reasoning{content:[{type:"reasoning_text",text}]} → 思考块。
 */

import type { CliTranscriptBlock } from "@kernel/cli";
import type { TranscriptLineParser } from "../cli-shared/sessionTranscript";
import { toolPreviewKindOf } from "../cli-shared/sessionTranscript";
import { isWrapperText } from "../cli-shared/userMessages";

/** 外部 JSON 逐层收窄取 string;缺失/异型返回 undefined。 */
function stringField(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object" || !(key in obj)) return undefined;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : undefined;
}

function startedAtOf(event: Record<string, unknown>): number | undefined {
  const raw = stringField(event, "timestamp");
  if (!raw) return undefined;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : undefined;
}

/** codex 消息 content(input_text/output_text parts)→ 文本。 */
function codexMessageText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    if (p.type !== "input_text" && p.type !== "output_text" && p.type !== "reasoning_text") continue;
    const text = p.text;
    if (typeof text === "string" && text.trim()) parts.push(text);
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}
function codexCommandOf(argumentsJson: string | undefined): string | undefined {
  if (!argumentsJson) return undefined;
  try {
    const args = JSON.parse(argumentsJson) as Record<string, unknown>;
    return (
      stringField(args, "cmd") ??
      stringField(args, "command") ??
      stringField(args, "script")
    );
  } catch {
    return undefined;
  }
}

/** codex 行解析器(纯函数,可测)。 */
export const codexTranscriptLine: TranscriptLineParser = (event) => {
  const blocks: CliTranscriptBlock[] = [];
  if (event.type !== "response_item") return blocks;
  const payload = event.payload;
  if (!payload || typeof payload !== "object") return blocks;
  const p = payload as Record<string, unknown>;
  const payloadType = stringField(p, "type");
  const startedAt = startedAtOf(event);
  const id = stringField(p, "id");
  if (payloadType === "message") {
    const role = stringField(p, "role");
    if (role !== "user" && role !== "assistant") return blocks; // developer/system 注入
    const text = codexMessageText(p.content);
    if (!text || !id) return blocks;
    if (role === "user" && isWrapperText(text)) return blocks;
    blocks.push({ id, role, text, startedAt });
    return blocks;
  }
  if (payloadType === "reasoning") {
    const text = codexMessageText(p.content);
    if (text && id) blocks.push({ id, role: "reasoning", text, startedAt });
    return blocks;
  }
  if (payloadType === "function_call") {
    const name = stringField(p, "name") ?? "tool";
    const callId = stringField(p, "call_id") ?? id;
    const kind = toolPreviewKindOf(name);
    blocks.push({
      id: id ?? `${callId}#call`,
      role: "tool",
      text: "",
      startedAt,
      tool: {
        callId,
        title: name,
        status: "called",
        ...(kind === "shell"
          ? { preview: { kind: "shell" as const, output: codexCommandOf(stringField(p, "arguments")) } }
          : {}),
      },
    });
    return blocks;
  }
  if (payloadType === "function_call_output") {
    const callId = stringField(p, "call_id");
    const output = stringField(p, "output");
    if (callId && output?.trim()) {
      blocks.push({
        id: `${callId}#out`,
        role: "tool",
        text: output,
        startedAt,
        tool: { callId },
      });
    }
  }
  return blocks;
};
