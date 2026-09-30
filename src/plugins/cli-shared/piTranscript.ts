/**
 * pi 家族(omp/pi)转录行型解析器 —— piFamilySessions 工厂接线,两家消费
 * (≥2 cli-*,cli-shared 准入达标)。
 *
 * 行型实证(2026-09-28 本机 ~/.pi/agent/sessions 采样):
 * - {type:"message",id,timestamp,message:{role:"user",content:[text]}} → 用户块;
 *   content 可含 {type:"image",data,mimeType} 图片 part(2026-09-29 实证)→
 *   并入用户块 images(纯图片无文本也成块);
 * - {type:"message",…,message:{role:"fileMention",files:[{path,content,
 *   image:{type,mimeType,data}]}}(omp 粘贴图片独立行,2026-09-29 实证)→
 *   user 图片块;非图片附件(无 image)跳过;
 * - {type:"message",…,message:{role:"assistant",content:[{type:"thinking",thinking}|
 *   {type:"toolCall",id,name,arguments}|{type:"text",text}]}} → 各 part 独立成块;
 * - {type:"message",…,message:{role:"toolResult",toolCallId,toolName,
 *   content:[{type:"text",text}]}} → 工具结果块(pairToolResults 配对并入)。
 */

import type { CliTranscriptBlock, CliTranscriptImage, CliToolPreview } from "@kernel/cli";
import type { TranscriptLineParser } from "./sessionTranscript";
import { diffLinesFromStrings, startedAtOf, stringField, toolPreviewKindOf } from "./sessionTranscript";
import { isWrapperText, messageText } from "./userMessages";

/** pi 工具 arguments → 预览(command/oldStr/newStr;路径类工具形态随家族演进,宽容)。 */
export function piToolPreview(
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

/** pi 族 user content 的图片 part({type:"image",data,mimeType},本机实证 2026-09-29)。 */
function piUserImages(content: unknown): CliTranscriptImage[] {
  if (!Array.isArray(content)) return [];
  const images: CliTranscriptImage[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    if (p.type !== "image") continue;
    const data = stringField(p, "data");
    const mimeType = stringField(p, "mimeType");
    if (data && mimeType) images.push({ data, mimeType });
  }
  return images;
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
    const images = piUserImages(m.content);
    const visible = text && !isWrapperText(text) ? text : undefined;
    if (!visible && images.length === 0) return blocks;
    blocks.push({
      id,
      role: "user",
      text: visible ?? "",
      startedAt,
      images: images.length > 0 ? images : undefined,
    });
    return blocks;
  }
  if (role === "fileMention") {
    /* omp 新行型(2026-09-29 本机 ~/.omp 实证):粘贴图片存独立 fileMention
     * 行,files[].image{type,mimeType,data};非图片附件无 image 字段跳过。 */
    const files = m.files;
    if (!Array.isArray(files)) return blocks;
    const images: CliTranscriptImage[] = [];
    for (const file of files) {
      if (!file || typeof file !== "object") continue;
      const image = (file as Record<string, unknown>).image;
      if (!image || typeof image !== "object") continue;
      const data = stringField(image, "data");
      const mimeType = stringField(image, "mimeType");
      if (data && mimeType) images.push({ data, mimeType });
    }
    if (images.length > 0) {
      blocks.push({ id, role: "user", text: "", startedAt, images });
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
