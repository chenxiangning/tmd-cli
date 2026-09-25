/**
 * CLI 会话 JSONL → 对话 turns 解析(手机端会话屏「单独解析」的内核)。
 * 形状全部取自真实文件抓包(2026-09-23):
 * - omp/pi:`{"type":"message","message":{role,content:[{type:"text"|"thinking"|"toolUse",...}]}}`
 * - claude:`{"type":"user"|"assistant","message":{role,content:"<str>"|[{type:"text"|"tool_use"|"tool_result",...}]}}`
 * - codex(response_item):`{"type":"response_item","payload":{type:"message",role,content:[...]}}` — 文本面同构
 * 其它行(session/model_change/summary/queue-operation/thinking…)一律跳过。
 * 操作(tool)与正文分离返回:UI 据此把「操作行」与对话内容区分开。
 */

import { stripAnsi } from "./askDetect";

export interface TranscriptTurn {
  role: "user" | "assistant" | "tool";
  /** 文本内容;tool turn = 参数摘要(单行)。 */
  text: string;
  /** tool turn 的工具名。 */
  tool?: string;
}

const TURN_MAX = 600; // 单 turn 渲染上限;更长截断(移动端不需要全文)

/** 工具摘要:压成单行(芯片/折叠行只显示一行)。 */
function clip(s: string): string {
  const one = stripAnsi(s).replace(/\s+/g, " ").trim();
  return one.length > TURN_MAX ? `${one.slice(0, TURN_MAX)}…` : one;
}

/** 对话正文:剥 ANSI、去首尾空白,但保留换行 —— markdown 块级语法
 *  (标题/列表/围栏)依赖换行,压单行会让手机端格式渲染失效。 */
function clipText(s: string): string {
  const one = stripAnsi(s).trim();
  return one.length > TURN_MAX ? `${one.slice(0, TURN_MAX)}…` : one;
}

type Obj = Record<string, unknown>;
function asObj(v: unknown): Obj | null {
  return v && typeof v === "object" ? (v as Obj) : null;
}
function str(o: Obj | null, k: string): string {
  const v = o?.[k];
  return typeof v === "string" ? v : "";
}

/** content 部分 → turns(文本归 role,工具件归 tool)。 */
function pushParts(content: unknown, role: "user" | "assistant", out: TranscriptTurn[]): void {
  if (typeof content === "string") {
    const t = clipText(content);
    if (t) out.push({ role, text: t });
    return;
  }
  const parts = Array.isArray(content) ? content : [];
  for (const raw of parts) {
    const p = asObj(raw);
    if (!p) continue;
    const type = str(p, "type");
    if (type === "text" || type === "input_text" || type === "output_text") {
      const t = clipText(str(p, "text"));
      if (t) out.push({ role, text: t });
    } else if (type === "tool_use" || type === "toolUse" || type === "function_call") {
      const name = str(p, "name") || "tool";
      const input = asObj(p["input"]) ?? asObj(p["arguments"]);
      let brief = "";
      if (input) {
        const key = ["command", "file_path", "path", "pattern", "url", "query"].find((k) => typeof input[k] === "string");
        if (key) brief = String(input[key]);
      } else if (typeof p["arguments"] === "string") {
        brief = p["arguments"];
      }
      out.push({ role: "tool", tool: name, text: clip(brief) });
    }
    /* thinking / tool_result / image …:v1 不上图(结果噪音大;thinking 属内心戏) */
  }
}

/** 一行 jsonl → turns(无法识别的行返回空)。 */
function parseLine(line: string, out: TranscriptTurn[]): void {
  if (!line.includes('"')) return;
  let ev: unknown;
  try {
    ev = JSON.parse(line);
  } catch {
    return;
  }
  const e = asObj(ev);
  if (!e) return;
  const type = str(e, "type");
  if (type === "message" || type === "user" || type === "assistant") {
    const m = asObj(e["message"]);
    if (!m) return;
    /* pi 系(omp/pi)工具结果行:独立 message 行,role=toolResult + toolName,
     * content 是结果 text 段。非 user 即 assistant 的旧判法把它渲染成
     * 「助手正文文本墙」(2026-09-25 真机历史屏实证)→ 落 tool turn。 */
    if (str(m, "role") === "toolResult") {
      const texts = (Array.isArray(m["content"]) ? m["content"] : [])
        .map((raw) => str(asObj(raw), "text"))
        .filter(Boolean);
      if (texts.length) out.push({ role: "tool", tool: str(m, "toolName") || "tool", text: clip(texts.join("\n")) });
      return;
    }
    const role = str(m, "role") === "user" ? "user" : "assistant";
    pushParts(m["content"], role, out);
    return;
  }
  if (type === "response_item") {
    const p = asObj(e["payload"]);
    if (!p) return;
    if (str(p, "type") !== "message") {
      /* codex function_call 平级载体 */
      if (str(p, "type") === "function_call") {
        pushParts([p], "assistant", out);
      }
      return;
    }
    const role = str(p, "role") === "user" ? "user" : "assistant";
    pushParts(p["content"], role, out);
  }
}

export function parseTranscript(text: string): TranscriptTurn[] {
  const out: TranscriptTurn[] = [];
  for (const line of text.split("\n")) parseLine(line, out);
  return out;
}

/** 从 turns 里取最后 limit 条(完整展示最近的对话)。 */
export function tailTurns(turns: TranscriptTurn[], limit: number): TranscriptTurn[] {
  return turns.length > limit ? turns.slice(turns.length - limit) : turns;
}
