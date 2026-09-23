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

function clip(s: string): string {
  const one = stripAnsi(s).replace(/\s+/g, " ").trim();
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
    const t = clip(content);
    if (t) out.push({ role, text: t });
    return;
  }
  const parts = Array.isArray(content) ? content : [];
  for (const raw of parts) {
    const p = asObj(raw);
    if (!p) continue;
    const type = str(p, "type");
    if (type === "text" || type === "input_text" || type === "output_text") {
      const t = clip(str(p, "text"));
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

/** 尾部窗口条数上限。 */
export const TAIL_WINDOW = 400;

/**
 * 终端重绘折叠:交互式 CLI(omp 等)每帧用 \r 原地重画,剥掉转义码后正文帧
 * 会整段堆叠成「重复渲染」。按终端语义折叠:行内取最后一个 \r 段(覆盖写),
 * 相邻重复行去重,空行压缩。ponytail: 全局线性折叠,不做真终端网格模型;
 * 若需逐格还原(表格对齐)再上 xterm.js 解析层。
 */
export function collapseTui(text: string): string {
  const lines = text.split("\n").map((line) => {
    const segs = line.split("\r");
    return segs[segs.length - 1].replace(/[\u0008\u001b]/g, "").replace(/\s+$/, "");
  });
  const out: string[] = [];
  for (const t of lines) {
    if (t !== "" && out.length && out[out.length - 1] === t) continue; // 帧重绘
    out.push(t);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * jsonl 文本(可为截断的尾部窗口)→ turns,保序。
 * 尾部窗口首行可能是残行:首行解析失败自然跳过,不影响后续。
 */
export function parseTranscript(text: string): TranscriptTurn[] {
  const out: TranscriptTurn[] = [];
  for (const line of text.split("\n")) parseLine(line, out);
  return out;
}

/** 从 turns 里取最后 limit 条(完整展示最近的对话)。 */
export function tailTurns(turns: TranscriptTurn[], limit: number): TranscriptTurn[] {
  return turns.length > limit ? turns.slice(turns.length - limit) : turns;
}

/**
 * 从 jsonl 尾部窗口文本提取所属 cwd(session 头行携带;omp/pi 实证)。
 * claude 文件无 session 头 → null(调用方按 slug 目录已定位,不需要它)。
 */
export function transcriptCwd(text: string): string | null {
  for (const line of text.split("\n")) {
    if (!line.includes('"')) continue;
    try {
      const e = asObj(JSON.parse(line));
      const cwd = e && typeof e["cwd"] === "string" ? (e["cwd"] as string) : null;
      if (cwd) return cwd;
      if (e && str(e, "type")) return null; // 首个可解析行不是 session 头 → 无 cwd
    } catch {
      /* 残行跳过 */
    }
  }
  return null;
}
