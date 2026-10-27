/**
 * 识别 pass prompt 与回复解析(从 aiJudge 拆出;300 行铁则)。
 * 整文件单调用:全文带行号发模型,一次返回全部需判定行(调用次数 = 文件数,不是批数)。
 */

import { stripAnsi } from "@kernel/askDetect";

export interface AiMarkRaw {
  line: number;
  recognizable: boolean;
  reason: string;
  rewrite?: string;
}

/** 组装识别指令(整文件版):全文带行号一次发出,逐条给 ok/why/fix,单文件单调用。 */
export function buildRecognizeInstruction(label: string, text: string, focusLines: number[]): string {
  const numbered = text.split("\n").map((l, i) => `L${i + 1}: ${l}`).join("\n");
  return [
    `你是 AI 编程助手。下面是一份${label}的完整内容(每行前缀 L行号)。请只针对「本次需判定行」列出的行,逐条判断你能否识别并真正遵守这条规则(结合全文感知是否有冲突/重复)。`,
    "",
    "本次需判定行:" + focusLines.join(", "),
    "",
    "判定口径:",
    '- ok=true:你能识别这条规则的意图,并且在后续编程工作中能执行它(指令清晰、无歧义、可操作)',
    '- ok=false:你无法识别或无法执行(原因如:指令含糊/互相冲突/指向不存在的上下文/过于抽象无法落地/纯愿景无操作含义)',
    "",
    "输出契约:把结果完整包在 <RECOG> 与 </RECOG> 标记之间,内容是一个 JSON 数组,每条对应一个需判定行:",
    '{"l": 行号数字, "ok": true/false, "why": "一句话中文说明", "fix": "仅 ok=false 时给:改写后的整行规则文本(可直接替换原行,含必要的 bullet 前缀;能给出清晰可执行的写法才给,给不出就省略此字段)"}',
    "只输出需判定行的结果,不要漏行;标记之外不要输出任何内容。",
    "",
    "=== 完整文件 ===",
    numbered,
  ].join("\n");
}

function sanitizeMarkReason(r: unknown): string {
  return typeof r === "string" ? r.replace(/\s+/g, " ").trim().slice(0, 200) : "";
}

/** 模型回复 → 逐行识别标记(哨兵内 JSON 优先;坏项跳过不连坐)。 */
export function parseRecognizeReply(raw: string): AiMarkRaw[] {
  const text = stripAnsi(raw);
  const m = text.match(/<RECOG>([\s\S]*?)<\/RECOG>/);
  const body = m ? m[1]!.trim() : "";
  const out: AiMarkRaw[] = [];
  const tryItem = (v: unknown) => {
    if (typeof v !== "object" || v === null) return;
    const o = v as Record<string, unknown>;
    const line = typeof o.l === "number" ? o.l : Number.parseInt(String(o.l ?? ""), 10);
    if (!Number.isInteger(line) || line < 1) return;
    if (typeof o.ok !== "boolean") return;
    const item: AiMarkRaw = { line, recognizable: o.ok, reason: sanitizeMarkReason(o.why) };
    if (!o.ok && typeof o.fix === "string" && o.fix.trim()) item.rewrite = o.fix.trim().slice(0, 400);
    out.push(item);
  };
  const tryParse = (s: string): boolean => {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) {
        arr.forEach(tryItem);
        return true;
      }
    } catch { /* 整段失败走逐对象捞 */ }
    return false;
  };
  if (body) {
    const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (!tryParse(fenced ? fenced[1]! : body)) {
      for (const obj of body.match(/\{[^{}]*\}/g) ?? []) {
        try {
          tryItem(JSON.parse(obj));
        } catch { /* 单对象坏不连坐 */ }
      }
    }
  }
  return out;
}
