/**
 * 单次调用协议(用户裁决:一次体检=1 次模型调用)。
 * 发全部规则+脚本测量,一次回全部 识别标记+最终判定;prompt/解析在此,判定执行仍走 aiJudge.runJudgeRaw。
 */

import { stripAnsi } from "@kernel/askDetect";
import type { LintVerdict, RuleEvidence, RuleItem } from "./lintTypes";

/* ── 单次调用(用户裁决:一次体检=1 次模型调用):全部规则+脚本测量 → 识别标记+最终判定 ── */

/** 统一指令条目(规则+脚本测量;测量即用户定义的「脚本自身判断的结果」)。 */
export type UnifiedInput = { rule: RuleItem; evidence: RuleEvidence };

const VERDICT_CODES = "working=真的在做|violated=AI不听|touched=只是提到|dormant=没人用|unverifiable=说不清";

/** 单调用指令:每条规则一行(带序号+脚本测量),模型一次回全部;why 限 20 字压输出量。 */
export function buildUnifiedInstruction(items: UnifiedInput[], hasCorpus: boolean): string {
  const lines = items.map(
    ({ rule, evidence }, i) =>
      `${i}|${rule.text}|触达${evidence.hits}/会话${evidence.activeSessions}/纠正${evidence.corrections}/照做${evidence.complied}`,
  );
  return [
    "你是 AI 编程助手。下面是项目的全部规则(序号|规则原文|脚本测量:近30天统计)。对每条规则给出你最终的真实认知:",
    "1. ok:你能否识别并真正遵守(true/false)",
    `2. v:最终判定,取 ${VERDICT_CODES}`,
    "3. why:一句话中文说明(≤20字)",
    "4. fix:仅 ok=false 时给改写后的完整规则行;给不出就省略",
    hasCorpus ? "脚本测量供参考,以你的真实认知为准。" : "(注意:本次语料为空,测量计数全 0,按规则文本本身判断。)",
    "",
    "输出契约:结果包在 <JUDGE> 与 </JUDGE> 之间,JSON 数组,每条一行:",
    '{"i": 序号数字, "ok": true/false, "v": "working|violated|touched|dormant|unverifiable", "why": "≤20字", "fix": "可选"}',
    "不要漏行,不要输出标记之外的任何内容。",
    "",
    "=== 规则清单 ===",
    lines.join("\n"),
  ].join("\n");
}

/** 统一回复项(i 对位规则序号)。 */
export interface UnifiedItem {
  i: number;
  ok: boolean;
  v: LintVerdict;
  why: string;
  fix?: string;
}

const VERDICT_SET = new Set<string>(["working", "violated", "touched", "dormant", "unverifiable"]);

const sanitizeWhy = (r: unknown): string => (typeof r === "string" ? r.replace(/\s+/g, " ").trim().slice(0, 200) : "");

/** 单调用回复解析(<JUDGE> 哨兵 JSON;坏项/越界跳过,缺行由调用方按缺口上报)。 */
export function parseUnifiedReply(raw: string, maxIndex = Number.MAX_SAFE_INTEGER): UnifiedItem[] {
  const m = stripAnsi(raw).match(/<JUDGE>([\s\S]*?)<\/JUDGE>/);
  const body = m ? m[1]!.trim() : "";
  const out: UnifiedItem[] = [];
  const tryItem = (v: unknown) => {
    if (typeof v !== "object" || v === null) return;
    const o = v as Record<string, unknown>;
    const i = typeof o.i === "number" ? o.i : Number.parseInt(String(o.i ?? ""), 10);
    if (!Number.isInteger(i) || i < 0 || i > maxIndex) return;
    if (typeof o.ok !== "boolean") return;
    const verdict = String(o.v ?? "");
    if (!VERDICT_SET.has(verdict)) return;
    out.push({ i, ok: o.ok, v: verdict as LintVerdict, why: sanitizeWhy(o.why) });
    const last = out[out.length - 1]!;
    if (!o.ok && typeof o.fix === "string" && o.fix.trim()) last.fix = o.fix.trim().slice(0, 400);
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
