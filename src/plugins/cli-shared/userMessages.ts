/**
 * 用户消息锚点提取 —— 从 CLI 会话 jsonl 中收集真实用户输入(锚点栏数据层)。
 *
 * 行型知识属各 CLI,五种实证解析器都在这里:
 * - omp/pi:`{"type":"message","id":…,"message":{"role":"user","content":[…]}}`
 * - claude:`{"type":"user","uuid":…,"message":{"role":"user","content":[…]}}`(isSidechain 跳过)
 * - codex:`{"type":"response_item","payload":{"type":"message","role":"user","content":[…]}}`
 * - grok:`{"type":"user","content":[…]}`,真实输入包裹 <user_query> 标签(system prompt 协议)
 *
 * 非用户语义一律跳过:tool_result 行、XML 包装(<command-…/<system-reminder…)、
 * AGENTS.md 指令包装(diskSessions 标题归一同规则)。
 */

import { ipc } from "@kernel/ipc";
import type { CliUserMessage } from "@kernel/cli";

/**
 * 增量轮询的尾部窗口:与状态扫描同量级(256KB→512KB)。
 * 两轮间隔内的输出爆发超出窗口会漏锚点 —— 导航精度降级,可接受。
 */
const TAIL_BYTES = 512 * 1024;
/**
 * 全量窗口:首轮激活用。绝不走 fsReadFile —— 那是预览 API,512KB 上限,
 * 会话 jsonl 常态 4-6MB 必被拒(2026-09-02 事故:读失败被当空结果,历史锚点全丢)。
 * read_tail 无上限、seek 尾部读,32MB 预算覆盖真实会话;超出则最老锚点缺失(导航降级)。
 */
const FULL_BYTES = 32 * 1024 * 1024;

/**
 * content 字段(string | [{type:"text"|"input_text",text}…]) → 全部纯文本段拼接;
 * tool_result 等异型跳过。导出给 kimi 等行型变体复用(其用户输入载荷与 omp/pi 同构)。
 */
export function messageText(content: unknown): string | undefined {
  if (typeof content === "string") return content.trim() ? content : undefined;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const type = (part as Record<string, unknown>).type;
    if (type !== "text" && type !== "input_text") continue;
    const text = (part as Record<string, unknown>).text;
    if (typeof text === "string" && text.trim()) parts.push(text);
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

/** 包装消息判定:XML 包装与 AGENTS.md 指令注入都不是用户真实输入。 */
function isWrapperText(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("<") || t.startsWith("# AGENTS.md instructions");
}

/** 外部 JSON 逐层收窄后取字符串字段;缺失/异型/空串返回 undefined。 */
function stringField(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object" || !(key in obj)) return undefined;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : undefined;
}

/** 行解析器:一行已解析 json → 用户消息;非用户消息返回 null。 */
export type UserMessageLineParser = (
  event: Record<string, unknown>,
) => CliUserMessage | null;

/** omp/pi 共享行型。 */
export const ompPiUserMessageLine: UserMessageLineParser = (event) => {
  if (event.type !== "message") return null;
  const message = event.message;
  if (!message || typeof message !== "object") return null;
  if (stringField(message, "role") !== "user") return null;
  const text = messageText((message as Record<string, unknown>).content);
  const id = stringField(event, "id");
  if (!text || !id || isWrapperText(text)) return null;
  return { id, text };
};

/** claude 行型;subagent sidechain 不进主幕布,跳过。 */
export const claudeUserMessageLine: UserMessageLineParser = (event) => {
  if (event.type !== "user" || event.isSidechain === true) return null;
  const message = event.message;
  if (!message || typeof message !== "object") return null;
  if (stringField(message, "role") !== "user") return null;
  const text = messageText((message as Record<string, unknown>).content);
  const id = stringField(event, "uuid");
  if (!text || !id || isWrapperText(text)) return null;
  return { id, text };
};

/**
 * qoder 行型(claude fork 实证 2026-09-02):origin.kind=human 是真实人工输入的
 * 判别字段,工具结果/注入行不具备;sidechain 同 claude 跳过。独立声明不复用
 * claude 行型 —— 两 CLI 契约各自演进,不暗中耦合。
 */
export const qoderUserMessageLine: UserMessageLineParser = (event) => {
  if (event.type !== "user" || event.isSidechain === true) return null;
  const origin = event.origin;
  if (!origin || typeof origin !== "object") return null;
  if (stringField(origin, "kind") !== "human") return null;
  const message = event.message;
  if (!message || typeof message !== "object") return null;
  if (stringField(message, "role") !== "user") return null;
  const text = messageText((message as Record<string, unknown>).content);
  const id = stringField(event, "uuid");
  if (!text || !id || isWrapperText(text)) return null;
  return { id, text };
};

/** codex 行型(response_item 包装)。 */
export const codexUserMessageLine: UserMessageLineParser = (event) => {
  if (event.type !== "response_item") return null;
  const payload = event.payload;
  if (!payload || typeof payload !== "object") return null;
  if (stringField(payload, "type") !== "message") return null;
  if (stringField(payload, "role") !== "user") return null;
  const text = messageText((payload as Record<string, unknown>).content);
  const id = stringField(payload, "id");
  if (!text || !id || isWrapperText(text)) return null;
  return { id, text };
};

/** FNV-1a 32 位文本 hash —— 非加密用途的稳定去重键。 */
function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** content 块内 <user_query>…</user_query> 真实输入提取;无包裹 = 非用户语义。 */
function grokUserQueryText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const text = (part as Record<string, unknown>).text;
    if (typeof text !== "string") continue;
    for (const m of text.matchAll(/<user_query>\n?([\s\S]*?)\n?<\/user_query>/g)) {
      const inner = m[1].trim();
      if (inner) parts.push(inner);
    }
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

/**
 * grok 行型(实证 chat_history.jsonl):content 直挂 event(行型 user/assistant/
 * reasoning/system 四种),真实输入由 CLI 包裹 <user_query> 标签 —— system-reminder
 * 等 MCP/skill 注入行无此包裹,天然滤除。
 * id:grok 消息行无 uuid/payload id;尾部增量窗口读不到全量行号,用文本 FNV-1a hash
 * 充当去重键 —— 同文重复消息折叠为单锚点,可接受降级。
 */
export const grokUserMessageLine: UserMessageLineParser = (event) => {
  if (event.type !== "user") return null;
  const text = grokUserQueryText(event.content);
  if (!text) return null;
  return { id: `gk:${fnv1a32(text)}`, text };
};

/**
 * 文本块 → 顺序用户消息列表(纯函数,可测)。
 * 行预筛避免全量 JSON.parse(role 型四家 + type 型 grok);坏行(窗口截断)跳过。
 */
export function parseUserMessages(
  text: string,
  parse: UserMessageLineParser,
): CliUserMessage[] {
  const out: CliUserMessage[] = [];
  for (const line of text.split("\n")) {
    /* kimi 行型是 message.type === "TurnBegin",不含 role/type 两个子串;
       漏补会让 kimi 用户消息锚点全丢 */
    if (
      !line.includes('"role":"user"') &&
      !line.includes('"type":"user"') &&
      !line.includes('"TurnBegin"')
    ) {
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") continue;
    const message = parse(event as Record<string, unknown>);
    if (message) out.push(message);
  }
  return out;
}

/**
 * 读会话文件并提取用户消息。
 * full = true 整文件读(会话激活首轮,32MB 尾窗即全量);false 尾部窗口增量读。
 * 读取失败返回 null(≠ 零消息):调用方据此不推进 fullLoaded,下轮重试全量。
 */
export async function readUserMessagesFromFile(
  path: string,
  full: boolean,
  parse: UserMessageLineParser,
): Promise<CliUserMessage[] | null> {
  const text = await ipc
    .fsReadTail(path, full ? FULL_BYTES : TAIL_BYTES)
    .catch(() => null);
  if (text === null) return null;
  return parseUserMessages(text, parse);
}

/** 在 CLI 会话目录里按 id 找 jsonl 文件(omp/pi/codex 的文件名都含会话 id)。 */
export async function findJsonlSessionFile(
  dir: string,
  cliSessionId: string,
): Promise<string | null> {
  const files = await ipc.fsCollectFiles(dir, ".jsonl").catch(() => []);
  return files.find((entry) => entry.name.includes(cliSessionId))?.path ?? null;
}
