/**
 * pi 家族(omp/pi)转录行型解析器 —— piFamilySessions 工厂接线,两家消费
 * (≥2 cli-*,cli-shared 准入达标)。
 *
 * 行型实证(2026-09-28 本机 ~/.pi/agent/sessions 采样):
 * - {type:"message",id,timestamp,message:{role:"user",content:[text]}} → 用户块;
 * - {type:"message",…,message:{role:"assistant",content:[{type:"thinking",thinking}|
 *   {type:"toolCall",id,name,arguments}|{type:"text",text}]}} → 各 part 独立成块;
 * - {type:"message",…,message:{role:"toolResult",toolCallId,toolName,
 *   content:[{type:"text",text}]}} → 工具结果块(pairToolResults 配对并入)。
 */

import type { CliTranscriptBlock, CliToolPreview } from "@kernel/cli";
import type { TranscriptLineParser } from "./sessionTranscript";
import { diffLinesFromStrings, toolPreviewKindOf } from "./sessionTranscript";
import { isWrapperText, messageText } from "./userMessages";

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

/** pi 工具 arguments → 预览(command/oldStr/newStr;路径类工具形态随家族演进,宽容)。 */
function piToolPreview(
  name: string,
  args: Record<string, unknown>,
): CliToolPreview | undefined {
  const kind = toolPreviewKindOf(name);
  if (!kind) return undefined;
  const preview: CliToolPreview = { kind };
  if (kind === "shell") {
    preview.output = stringField(args, "command");
  } else if (kind === "write") {
    preview.path = stringField(args, "path") ?? stringField(args, "file_path");
    preview.lines = diffLinesFromStrings(
      stringField(args, "oldStr"),
      stringField(args, "newStr"),
    );
  } else if (kind === "read") {
    preview.path = stringField(args, "path") ?? stringField(args, "file_path");
  } else {
    preview.query = stringField(args, "query") ?? stringField(args, "pattern");
  }
  return preview;
}

/** pi 家族行解析器(纯函数,可测)。 */
export const piTranscriptLine: TranscriptLineParser = (event) => {
  const blocks: CliTranscriptBlock[] = [];
  if (event.type !== "message") return blocks;
  const message = event.message;
  if (!message || typeof message !== "object") return blocks;
  const m = message as Record<string, unknown>;
  const role = stringField(m, "role");
  const id = stringField(event, "id");
  if (!id) return blocks;
  const startedAt = startedAtOf(event);
  if (role === "user") {
    const text = messageText(m.content);
    if (text && !isWrapperText(text)) {
      blocks.push({ id, role: "user", text, startedAt });
    }
    return blocks;
  }
  if (role === "assistant") {
    const content = m.content;
    if (!Array.isArray(content)) return blocks;
    content.forEach((part, index) => {
      if (!part || typeof part !== "object") return;
      const p = part as Record<string, unknown>;
      const blockId = `${id}#${index}`;
      const type = stringField(p, "type");
      if (type === "text") {
        const text = stringField(p, "text");
        if (text?.trim()) blocks.push({ id: blockId, role: "assistant", text, startedAt });
      } else if (type === "thinking") {
        const text = stringField(p, "thinking");
        if (text?.trim()) blocks.push({ id: blockId, role: "reasoning", text, startedAt });
      } else if (type === "toolCall") {
        const callId = stringField(p, "id");
        const name = stringField(p, "name") ?? "tool";
        const rawArgs = p.arguments;
        const args =
          rawArgs && typeof rawArgs === "object"
            ? (rawArgs as Record<string, unknown>)
            : {};
        blocks.push({
          id: blockId,
          role: "tool",
          text: "",
          startedAt,
          tool: {
            callId,
            title: name,
            status: "called",
            preview: piToolPreview(name, args),
          },
        });
      }
    });
    return blocks;
  }
  if (role === "toolResult") {
    const callId = stringField(m, "toolCallId");
    const text = messageText(m.content) ?? "";
    if (callId && text.trim()) {
      blocks.push({ id: `${id}#res`, role: "tool", text, startedAt, tool: { callId } });
    }
  }
  return blocks;
};
