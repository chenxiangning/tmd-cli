/**
 * dsh 会话转录 —— ~/.dsh/sessions/<slug>/session-<uuid>/session.jsonl.zstd
 * (zstd 压缩 JSONL 事件流)。读取走 kernel 通用二进制原语 fsReadBytesBase64,
 * JS 侧 fzstd 解压(纯 JS 解码器,零 Rust CLI 知识),行循环复用 cli-shared
 * sessionTranscript 骨架。
 *
 * 行型实证(2026-09-28 本机采样;2026-09-30 复采 v3/v4):
 * - 盘面文件名随 dsh 版本带格式版本号:session.jsonl.zstd → session.v3/v4…,
 *   事件类型与字段两代兼容,唯两处形变见下。
 * - {type:"user/message",time,data:{content:[text parts],source:{kind},id}}:
 *   source.kind === "user" 判别人工输入(v3/v4 新增 runtime-context /
 *   skill-catalog 播报,kind 门控一并跳过)。
 * - {type:"assistant/message",data:{message:{content:[{type:"text",text}|
 *   {type:"tool-call",id,name}]}}};v3 起 data.messageId 消失,块 id 退
 *   event.seq 兜底。
 * - {type:"tool/call",data:{callId,name,arguments(JSON 字符串)}} → 工具块。
 * - {type:"tool/result"} 两代形制:v3 = data.message.content[{type:
 *   "tool-result",toolCallId,content:[…]}](包裹层);v4 扁平化 = data.
 *   message.{toolCallId,content:[{type:"text",…}],isError}(包裹层取消)。
 */

import { Decompress } from "fzstd";
import { ipc } from "@kernel/ipc";
import type { CliSessionTranscript, CliTranscriptBlock } from "@kernel/cli";
import { pairToolResults, parseTranscriptBlocks, stringField, TRANSCRIPT_BYTES, type TranscriptLineParser } from "../cli-shared/sessionTranscript";
import { toolPreviewKindOf } from "../cli-shared/sessionTranscript";
import { messageText } from "../cli-shared/userMessages";
import { findDshSessionZstd } from "./dshSessionStore";

/** tool/call 的 arguments(JSON 字符串)→ 命令文本(command/cmd 键)。 */
function dshCommandOf(argumentsJson: string | undefined): string | undefined {
  if (!argumentsJson) return undefined;
  try {
    const args = JSON.parse(argumentsJson) as Record<string, unknown>;
    return (
      stringField(args, "command") ??
      stringField(args, "cmd") ??
      stringField(args, "program")
    );
  } catch {
    return undefined;
  }
}

/** dsh 行解析器(纯函数,可测)。 */
export const dshTranscriptLine: TranscriptLineParser = (event) => {
  const blocks: CliTranscriptBlock[] = [];
  const data = event.data;
  const d = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const time = typeof event.time === "number" ? event.time : undefined;
  if (event.type === "user/message") {
    const source = d.source;
    const kind =
      source && typeof source === "object"
        ? stringField(source, "kind")
        : undefined;
    if (kind !== "user") return blocks;
    const id = stringField(d, "id");
    const text = messageText(d.content);
    if (id && text) blocks.push({ id, role: "user", text, startedAt: time });
    return blocks;
  }
  if (event.type === "assistant/message") {
    const message = d.message;
    const m = message && typeof message === "object" ? (message as Record<string, unknown>) : null;
    if (!m) return blocks;
    /* v3 起 messageId 消失:退 event.seq 保块 id 全局唯一(React key)。 */
    const messageId =
      stringField(d, "messageId") ??
      (typeof event.seq === "number" ? `seq${event.seq}` : "asst");
    const content = m.content;
    if (!Array.isArray(content)) return blocks;
    content.forEach((part, index) => {
      if (!part || typeof part !== "object") return;
      const p = part as Record<string, unknown>;
      const type = stringField(p, "type");
      const id = `${messageId ?? "asst"}#${index}`;
      if (type === "text") {
        const text = stringField(p, "text");
        if (text?.trim()) blocks.push({ id, role: "assistant", text, startedAt: time });
      }
      /* tool-call part 不产块:完整真相在同 turn 的 tool/call 事件(带
       *  arguments;实证两者总成对出现,part 是无参镜像,产块会重复)。 */
    });
    return blocks;
  }
  if (event.type === "tool/call") {
    const callId = stringField(d, "callId");
    const name = stringField(d, "name") ?? "tool";
    const kind = toolPreviewKindOf(name);
    blocks.push({
      id: `${callId ?? name}#call`,
      role: "tool",
      text: "",
      startedAt: time,
      tool: {
        callId,
        title: name,
        status: "called",
        ...(kind === "shell"
          ? { preview: { kind: "shell" as const, output: dshCommandOf(stringField(d, "arguments")) } }
          : {}),
      },
    });
    return blocks;
  }
  if (event.type === "tool/result") {
    const message = d.message;
    const m = message && typeof message === "object" ? (message as Record<string, unknown>) : null;
    const content = m?.content;
    if (!Array.isArray(content)) return blocks;
    /* 两代形制:v4 扁平(toolCallId 在 message 本体,content 即 text parts),
     * v3 包裹(toolCallId 在 content 的 tool-result part 里)。message 带
     * toolCallId 判新形,否则回扫旧形 part。 */
    const directId = stringField(m, "toolCallId");
    const results = directId
      ? [{ callId: directId, text: messageText(content) ?? "" }]
      : content.flatMap((part) => {
          if (!part || typeof part !== "object") return [];
          const p = part as Record<string, unknown>;
          if (stringField(p, "type") !== "tool-result") return [];
          const callId = stringField(p, "toolCallId");
          return callId ? [{ callId, text: messageText(p.content) ?? "" }] : [];
        });
    for (const { callId, text } of results) {
      if (text.trim()) {
        blocks.push({
          id: `${callId}#res`,
          role: "tool",
          text,
          startedAt: time,
          tool: { callId },
        });
      }
    }
  }
  return blocks;
};

/** 会话盘文件名版本号判据:与删除/定位通路共用 dshSessionStore(见该文件头)。 */
export { zstdVersionOf } from "./dshSessionStore";

/** CliDiskSession(id 即会话 id,path 是 origin 调试串不可用)→ 转录。 */
export async function readDshSessionTranscript(
  cliSessionId: string,
): Promise<CliSessionTranscript | null> {
  const zstd = await findDshSessionZstd(cliSessionId);
  if (!zstd) return null;
  return readDshTranscript(zstd);
}

/** 带 decoding 字节预算的流式解压:压缩盘 32MB 读闸内可解出 >100MB(极端
 *  大会话),超预算停喂截尾并置 truncated(对齐全族 TRANSCRIPT_BYTES 尾窗
 *  截断语义);1MB 分片喂入,超限即止不再解余量。导出供测试注入小预算。 */
export function decompressZstdWithBudget(
  bytes: Uint8Array,
  budget = TRANSCRIPT_BYTES,
): { text: string; truncated: boolean } {
  const parts: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  const d = new Decompress((chunk: Uint8Array) => {
    const room = budget - total;
    if (room <= 0) {
      truncated = true;
      return;
    }
    const take = chunk.length > room ? chunk.subarray(0, room) : chunk;
    parts.push(take);
    total += take.length;
    if (take.length < chunk.length) truncated = true;
  });
  const STEP = 1 << 20;
  for (let i = 0; i < bytes.length && !truncated; i += STEP) {
    d.push(bytes.subarray(i, Math.min(i + STEP, bytes.length)), i + STEP >= bytes.length);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return { text: new TextDecoder().decode(out), truncated };
}

/** 读 dsh zstd 会话 → 解压 → 转录。文件不存在/解压失败 = null。 */
export async function readDshTranscript(
  path: string,
): Promise<CliSessionTranscript | null> {
  const base64 = await ipc.fsReadBytesBase64(path).catch(() => null);
  if (base64 === null) return null;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  let decoded: { text: string; truncated: boolean };
  try {
    decoded = decompressZstdWithBudget(bytes);
  } catch {
    return null;
  }
  return {
    blocks: pairToolResults(parseTranscriptBlocks(decoded.text, dshTranscriptLine)),
    truncated: decoded.truncated,
  };
}
