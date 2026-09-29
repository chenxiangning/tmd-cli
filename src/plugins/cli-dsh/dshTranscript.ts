/**
 * dsh 会话转录 —— ~/.dsh/sessions/<slug>/session-<uuid>/session.jsonl.zstd
 * (zstd 压缩 JSONL 事件流)。读取走 kernel 通用二进制原语 fsReadBytesBase64,
 * JS 侧 fzstd 解压(纯 JS 解码器,零 Rust CLI 知识),行循环复用 cli-shared
 * sessionTranscript 骨架。
 *
 * 行型实证(2026-09-28 本机采样):
 * - {type:"user/message",time,data:{content:[text parts],source:{kind},id}}:
 *   source.kind === "user" 判别人工输入(插件播报 kind=plugin,跳过)。
 * - {type:"assistant/message",data:{message:{content:[{type:"text",text}|
 *   {type:"tool-call",id,name}]}}} → 各 part 独立成块。
 * - {type:"tool/call",data:{callId,name,arguments(JSON 字符串)}} → 工具块。
 * - {type:"tool/result",data:{message:{content:[{type:"tool-result",
 *   toolCallId,content:[{type:"text",text}],isError?}]}}} → 结果块。
 */

import { Decompress } from "fzstd";
import { ipc } from "@kernel/ipc";
import type { CliSessionTranscript, CliTranscriptBlock } from "@kernel/cli";
import { pairToolResults, parseTranscriptBlocks, TRANSCRIPT_BYTES, type TranscriptLineParser } from "../cli-shared/sessionTranscript";
import { toolPreviewKindOf } from "../cli-shared/sessionTranscript";
import { messageText } from "../cli-shared/userMessages";

/** 外部 JSON 逐层收窄取 string;缺失/异型返回 undefined。 */
function stringField(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object" || !(key in obj)) return undefined;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : undefined;
}

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
    const messageId = stringField(d, "messageId");
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
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      if (stringField(p, "type") !== "tool-result") continue;
      const callId = stringField(p, "toolCallId");
      const text = messageText(p.content) ?? "";
      if (callId && text.trim()) {
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

/** 定位会话 zstd 文件:扫 ~/.dsh/sessions/<slug>/ 一层找 session-<id> 目录
 *  (deleteHostSession 同款定位纪律:slug 规则不猜,会话 id 全局唯一)。 */
async function findDshSessionZstd(cliSessionId: string): Promise<string | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  const slugs = await ipc.fsListDir(`${home}/.dsh/sessions`).catch(() => []);
  for (const slug of slugs) {
    if (!slug.isDir) continue;
    const hit = (await ipc.fsListDir(slug.path).catch(() => []))
      .find((e) => e.isDir && (e.name === cliSessionId || e.name === `session-${cliSessionId}`));
    if (hit) return `${hit.path}/session.jsonl.zstd`;
  }
  return null;
}

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
