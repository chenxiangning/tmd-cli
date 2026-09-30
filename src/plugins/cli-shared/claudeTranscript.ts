/**
 * claude-code 家族转录行型 —— claude/qoder(qoder-cn 同构)共享解析器
 * (≥2 cli-* 消费,cli-shared 准入达标)。
 *
 * 行型实证(2026-09-28 本机 ~/.claude/projects 与 ~/.qoder/projects 采样):
 * - user 行 {type:"user",uuid,timestamp,isSidechain?,message:{role:"user",
 *   content:string|parts}}:parts 为 text(用户正文)与 tool_result
 *   {tool_use_id,content:string|parts}}(工具结果);sidechain 跳过;
 *   qoder 变体仅认 origin.kind="human"(qoderUserMessageLine 同款判别);
 *   user parts 可含 {type:"image",source:{type:"base64",media_type,data}}
 *   (Anthropic 标准形态)→ 并入本消息首个用户块 images,tool_result 信封不挂图。
 * - assistant 行 {type:"assistant",uuid,timestamp,message:{role:"assistant",
 *   content:[{type:"text",text}|{type:"thinking",thinking}|
 *   {type:"tool_use",id,name,input}]}}:每个 part 独立成块。
 */

import type { CliTranscriptBlock, CliTranscriptImage, CliToolPreview } from "@kernel/cli";
import type { TranscriptLineParser } from "./sessionTranscript";
import { diffLinesFromStrings, startedAtOf, stringField, toolPreviewKindOf } from "./sessionTranscript";
import { isWrapperText, messageText } from "./userMessages";

/** 工具 input → 预览(claude 家族工具名/参数形态:command/file_path/old_string/new_string/pattern)。 */
function claudeToolPreview(
  name: string,
  input: Record<string, unknown>,
): CliToolPreview | undefined {
  const kind = toolPreviewKindOf(name);
  if (!kind) return undefined;
  const preview: CliToolPreview = { kind };
  if (kind === "shell") {
    preview.output = stringField(input, "command");
  } else if (kind === "write") {
    preview.path = stringField(input, "file_path") ?? stringField(input, "path");
    preview.lines = diffLinesFromStrings(
      stringField(input, "old_string"),
      stringField(input, "new_string") ?? stringField(input, "content"),
    );
  } else if (kind === "read") {
    preview.path = stringField(input, "file_path") ?? stringField(input, "path");
  } else {
    preview.query = stringField(input, "pattern") ?? stringField(input, "query");
  }
  return preview;
}

/**
 * claude/qoder 家族行解析器(纯函数,可测)。variant="qoder" 时 user 行
 * 额外要求 origin.kind="human";两家契约各自演进,变体显式传参不暗中耦合。
 */
export function claudeTranscriptLine(
  variant: "claude" | "qoder",
): TranscriptLineParser {
  return (event) => {
    const blocks: CliTranscriptBlock[] = [];
    const startedAt = startedAtOf(event);
    const uuid = stringField(event, "uuid");
    if (event.type === "assistant") {
      const message = event.message;
      if (!message || typeof message !== "object" || !uuid) return blocks;
      const content = (message as Record<string, unknown>).content;
      if (!Array.isArray(content)) return blocks;
      content.forEach((part, index) => {
        if (!part || typeof part !== "object") return;
        const p = part as Record<string, unknown>;
        const id = `${uuid}#${index}`;
        const type = stringField(p, "type");
        if (type === "text") {
          const text = stringField(p, "text");
          if (text?.trim()) blocks.push({ id, role: "assistant", text, startedAt });
        } else if (type === "thinking") {
          const text = stringField(p, "thinking");
          if (text?.trim()) blocks.push({ id, role: "reasoning", text, startedAt });
        } else if (type === "tool_use") {
          const callId = stringField(p, "id");
          const name = stringField(p, "name") ?? "tool";
          const input = p.input;
          const inputRecord =
            input && typeof input === "object"
              ? (input as Record<string, unknown>)
              : {};
          blocks.push({
            id,
            role: "tool",
            text: "",
            startedAt,
            tool: {
              callId,
              title: name,
              status: "called",
              preview: claudeToolPreview(name, inputRecord),
            },
          });
        }
      });
      return blocks;
    }
    if (event.type === "user" && !event.isSidechain && uuid) {
      if (variant === "qoder") {
        const origin = event.origin;
        if (
          !origin ||
          typeof origin !== "object" ||
          stringField(origin, "kind") !== "human"
        ) {
          return blocks;
        }
      }
      const message = event.message;
      if (!message || typeof message !== "object") return blocks;
      const content = (message as Record<string, unknown>).content;
      if (typeof content === "string") {
        if (content.trim() && !isWrapperText(content)) {
          blocks.push({ id: uuid, role: "user", text: content, startedAt });
        }
        return blocks;
      }
      if (!Array.isArray(content)) return blocks;
      /* 图片 part(Anthropic 标准 base64 source 形态):并入本消息首个用户块;
       * 纯图片无文本也成块,但 tool_result 信封(工具回包)不算用户输入,跳过。 */
      const images: CliTranscriptImage[] = [];
      let hasToolResult = false;
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const p = part as Record<string, unknown>;
        const type = stringField(p, "type");
        if (type === "image") {
          const source =
            p.source && typeof p.source === "object"
              ? (p.source as Record<string, unknown>)
              : undefined;
          const data = source ? stringField(source, "data") : undefined;
          const mediaType = source ? stringField(source, "media_type") : undefined;
          if (data && mediaType) images.push({ data, mimeType: mediaType });
        } else if (type === "tool_result") {
          hasToolResult = true;
        }
      }
      const attach = images.length > 0 && !hasToolResult;
      let pushedUser = false;
      content.forEach((part, index) => {
        if (!part || typeof part !== "object") return;
        const p = part as Record<string, unknown>;
        const type = stringField(p, "type");
        if (type === "text") {
          const text = stringField(p, "text");
          if (text?.trim() && !isWrapperText(text)) {
            blocks.push({
              id: `${uuid}#${index}`,
              role: "user",
              text,
              startedAt,
              images: attach && !pushedUser ? images : undefined,
            });
            pushedUser = true;
          }
        } else if (type === "tool_result") {
          const callId = stringField(p, "tool_use_id");
          const raw = p.content;
          const text =
            typeof raw === "string"
              ? raw
              : Array.isArray(raw)
                ? (messageText(raw) ?? "")
                : "";
          if (callId && text.trim()) {
            blocks.push({
              id: `${uuid}#r${index}`,
              role: "tool",
              text,
              startedAt,
              tool: { callId },
            });
          }
        }
      });
      if (attach && !pushedUser) {
        blocks.push({ id: uuid, role: "user", text: "", startedAt, images });
      }
    }
    return blocks;
  };
}
