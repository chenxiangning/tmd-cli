/**
 * kimi 会话转录行型 —— wire.jsonl 事件流协议(protocol_version 1.5),
 * 行循环复用 cli-shared/sessionTranscript 骨架。
 *
 * 行型实证(2026-09-28 本机 ~/.kimi-code 采样):
 * - {type:"turn.prompt",origin:{kind:"user"},input:[text parts],promptId} →
 *   用户块(与锚点栏 kimiUserMessageLine 同源判别;老 home TurnBegin 行同)。
 * - {type:"context.append_loop_event",event:{...}} →
 *   · content.part:part.type="think" → 思考块,"text" → 助手块(uuid 作 id);
 *   · tool.call:{uuid,toolCallId,name,args} → 工具块(args.command 优先);
 *   · tool.result:{toolCallId,result.output:[{type:"text",text}]} → 结果块。
 */

import type { CliTranscriptBlock } from "@kernel/cli";
import type { TranscriptLineParser } from "../cli-shared/sessionTranscript";
import { stringField, toolPreviewKindOf } from "../cli-shared/sessionTranscript";
import { messageText } from "../cli-shared/userMessages";

/** kimi 工具 args → shell 命令文本(command/cmd 键;其余工具暂无实证形态)。 */
function kimiCommandOf(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const a = args as Record<string, unknown>;
  return stringField(a, "command") ?? stringField(a, "cmd");
}

/** kimi 行解析器(纯函数,可测)。 */
export const kimiTranscriptLine: TranscriptLineParser = (event) => {
  const blocks: CliTranscriptBlock[] = [];
  const time = typeof event.time === "number" ? event.time : undefined;
  if (event.type === "turn.prompt") {
    const origin = event.origin;
    if (
      origin &&
      typeof origin === "object" &&
      (origin as Record<string, unknown>).kind !== "user"
    ) {
      return blocks;
    }
    const text = messageText(event.input);
    const id =
      stringField(event, "promptId") ??
      (typeof event.time === "number" ? `t${event.time}` : undefined);
    if (text && id) blocks.push({ id, role: "user", text, startedAt: time });
    return blocks;
  }
  if (event.type !== "context.append_loop_event") return blocks;
  const inner = event.event;
  if (!inner || typeof inner !== "object") return blocks;
  const e = inner as Record<string, unknown>;
  const innerType = stringField(e, "type");
  if (innerType === "content.part") {
    const part = e.part;
    if (!part || typeof part !== "object") return blocks;
    const p = part as Record<string, unknown>;
    const partType = stringField(p, "type");
    const id = stringField(e, "uuid");
    if (!id) return blocks;
    if (partType === "think") {
      const text = stringField(p, "think");
      if (text?.trim()) blocks.push({ id, role: "reasoning", text, startedAt: time });
    } else if (partType === "text") {
      const text = stringField(p, "text");
      if (text?.trim()) blocks.push({ id, role: "assistant", text, startedAt: time });
    }
    return blocks;
  }
  if (innerType === "tool.call") {
    const callId = stringField(e, "toolCallId");
    const name = stringField(e, "name") ?? "tool";
    const id = stringField(e, "uuid") ?? callId;
    if (!id) return blocks;
    const kind = toolPreviewKindOf(name);
    blocks.push({
      id,
      role: "tool",
      text: "",
      startedAt: time,
      tool: {
        callId,
        title: name,
        status: "called",
        ...(kind === "shell"
          ? { preview: { kind: "shell" as const, output: kimiCommandOf(e.args) } }
          : {}),
      },
    });
    return blocks;
  }
  if (innerType === "tool.result") {
    const callId = stringField(e, "toolCallId");
    const result = e.result;
    const output =
      result && typeof result === "object"
        ? messageText((result as Record<string, unknown>).output)
        : undefined;
    if (callId && output?.trim()) {
      blocks.push({
        id: `${callId}#res`,
        role: "tool",
        text: output,
        startedAt: time,
        tool: { callId },
      });
    }
  }
  return blocks;
};
