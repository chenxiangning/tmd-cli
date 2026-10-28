/**
 * 证据测量 —— 规则 × 语料 → 证据包(移植 tmd-lint findings_evidence.rs 口径)。
 *
 * 三类证据:词面触达(区分度达标信号词)、当场纠正(user 消息同时命中信号词
 * 与纠正词表;词表刻意不含「不要」——它高频出现在普通任务指令里)、工具级
 * 照做(命令归一包含 / 路径落点观测,硬证据)。IDF 区分度门槛:语料 /2000
 * (至少 5)以上出现频次的词不作数——否则 `src`/`docs` 这类高频词把巧合当证据。
 * 本模块只测量不定罪;生效与否的语义判断归 AI(aiJudge.ts)。
 */

import type { CorpusMsg, LintVerdict, RuleEvidence, RuleItem, SessionCorpus } from "./lintTypes";
import { extractCommand } from "./rulesExtract";

/** 纠正词表(移植 CORRECTIONS;「不要」除外的原因见文件头)。 */
export const CORRECTIONS = [
  "不对", "不行", "错了", "不许", "我说", "说过", "铁律", "老规矩", "规矩",
  "重跑", "重来", "谁让", "又忘", "讲过", "说了算", "不听", "跟你说了", "提醒过",
];

const dfLimit = (corpus: number) => Math.max(5, Math.floor(corpus / 2000));

/** 命令归一:` run ` 折叠使 `pnpm run x` ≡ `pnpm x`(移植 normalize_cmd)。 */
export function normalizeCmd(s: string): string {
  return s.toLowerCase().replace(/ run /g, " ").trim();
}

/** 一次体检全部规则的区分度信号词与不可判标记(全语料词频一遍算)。 */
export function discriminativeTokens(
  rules: RuleItem[],
  msgs: CorpusMsg[],
): { byRule: string[][]; unjudgeable: boolean[] } {
  const limit = dfLimit(msgs.length);
  const vocab = [...new Set(rules.flatMap((r) => r.tokens))];
  const df = new Map<string, number>();
  for (const m of msgs) {
    for (const tk of vocab) {
      if (m.lower.includes(tk)) df.set(tk, (df.get(tk) ?? 0) + 1);
    }
  }
  const byRule = rules.map((r) =>
    r.tokens
      .filter((tk) => (df.get(tk) ?? 0) <= limit)
      .sort((a, b) => (df.get(a) ?? 0) - (df.get(b) ?? 0)), /* 最稀有优先 */
  );
  /* 零信号词(纯中文无「」/反引号/ASCII 段)视同不可判:否则 hits 恒 0 会被预判成 dormant(2026-10-28 实证)。 */
  const unjudgeable = rules.map((r, i) => r.tokens.length === 0 || byRule[i]!.length === 0);
  return { byRule, unjudgeable };
}

const QUOTE_CAP = 400;

function cut(s: string): string {
  return s.length > QUOTE_CAP ? `${s.slice(0, QUOTE_CAP)}…` : s;
}

/** 单条规则测证据:触达/纠正/照做三通道 + 首条引文(下钻展示用)。
 *  sessionFilter = 允许计入的 sessionIdx(项目口径=cwd 束;null=全部)。 */
export function measureEvidence(
  rule: RuleItem,
  disc: string[],
  unjudgeable: boolean,
  corpus: SessionCorpus,
  sessionFilter: Set<number> | null = null,
): RuleEvidence {
  const ev: RuleEvidence = {
    hits: 0, activeSessions: 0, lastSeen: 0, touchQuote: "",
    corrections: 0, correctionWords: [], correctionQuotes: [],
    complied: 0, complyQuote: "", discTokens: disc, unjudgeable,
    command: extractCommand(rule.text),
  };
  const touchedSessions = new Set<number>();
  const seenWords = new Set<string>();
  const seenSkeletons = new Set<string>();
  const inScope = (idx: number) => sessionFilter === null || sessionFilter.has(idx);
  for (const m of corpus.msgs) {
    if (!inScope(m.sessionIdx)) continue;
    const hit = disc.some((tk) => m.lower.includes(tk));
    if (!hit) continue;
    ev.hits += 1;
    touchedSessions.add(m.sessionIdx);
    if (m.ts > ev.lastSeen) ev.lastSeen = m.ts;
    if (!ev.touchQuote) ev.touchQuote = cut(m.text);
    if (m.role === "user" && CORRECTIONS.some((w) => m.lower.includes(w))) {
      ev.corrections += 1;
      for (const w of CORRECTIONS) {
        if (m.lower.includes(w) && !seenWords.has(w)) {
          seenWords.add(w);
          ev.correctionWords.push(w);
        }
      }
      if (ev.correctionQuotes.length < 3) {
        const q = cut(m.text);
        /* 去重与长文过滤:同段文本反复出现(如反复粘贴体检指令)只收一条;贴入的长文不是纠正证据。 */
        const skeleton = q.slice(0, 60);
        if (q.length <= 300 && !seenSkeletons.has(skeleton)) {
          seenSkeletons.add(skeleton);
          ev.correctionQuotes.push(q);
        }
      }
    }
  }
  ev.activeSessions = touchedSessions.size;
  if (ev.command) {
    const needle = normalizeCmd(ev.command);
    for (const c of corpus.calls) {
      if (inScope(c.sessionIdx) && normalizeCmd(c.detail).includes(needle)) {
        ev.complied += 1;
        if (!ev.complyQuote) ev.complyQuote = cut(c.detail);
      }
    }
  } else if (rule.pathRefs.length > 0) {
    for (const ref of rule.pathRefs) {
      for (const c of corpus.calls) {
        if (!inScope(c.sessionIdx)) continue;
        const d = c.detail.toLowerCase();
        if (d.includes("/") && !d.includes(" ") && d.includes(ref)) {
          ev.complied += 1;
          if (!ev.complyQuote) ev.complyQuote = cut(c.detail);
          break; /* 每个目录只计一次(越界观测的教训:不封顶就是天文数字) */
        }
      }
    }
  }
  return ev;
}

/** 全规则证据一次算;sessionFilterOf 按规则给会话束(项目=cwd 束/全局=null)。 */
export function measureAll(
  rules: RuleItem[],
  disc: string[][],
  unjudgeable: boolean[],
  corpus: SessionCorpus,
  sessionFilterOf?: (rule: RuleItem) => Set<number> | null,
): RuleEvidence[] {
  return rules.map((r, i) => measureEvidence(r, disc[i]!, unjudgeable[i]!, corpus, sessionFilterOf?.(r) ?? null));
}

/**
 * 脚本侧确定性预判(只按计数,不发语料):照做>0=working;纠正>0=violated;
 * 语料空或词面证据不可用=unverifiable;零触达=dormant;其余=touched。
 * 仅作 AI 最终判定的参考输入,不定罪(文件头口径)。
 */
export function scriptVerdict(ev: RuleEvidence, hasSessions: boolean): LintVerdict {
  if (ev.complied > 0) return "working";
  if (ev.corrections > 0) return "violated";
  if (!hasSessions || ev.unjudgeable) return "unverifiable";
  if (ev.hits === 0) return "dormant";
  return "touched";
}

/** 判定契约闸(提示词「判定铁律」的代码化;2026-10-28 实证模型会无视计数约束越权):
 *  - dormant(指控「没人用」)必须与 scriptVerdict 阶梯一致:全零且词面可用且有语料,否则回落阶梯值;
 *  - violated(指控「AI 不听」)需纠正>0,否则回落阶梯值(阶梯为 dormant 时落 unverifiable,不反转指控);
 *  - working/touched(主张「在用/提到」)计数全零时落 unverifiable——风格/宪法型规则照做不留词痕,
 *    零词面痕迹不构成「没人用」的证明,只构成「说不清」。
 *  unverifiable 恒放行;合法判定一律放行,闸只收口越权值。 */
export function enforceVerdictContract(v: LintVerdict, ev: RuleEvidence, hasSessions: boolean): LintVerdict {
  if (v === "unverifiable") return v;
  const floor = scriptVerdict(ev, hasSessions);
  if (v === "dormant") return floor === "dormant" ? v : floor;
  if (v === "violated") return ev.corrections > 0 ? v : floor === "dormant" ? "unverifiable" : floor;
  if (v === "working") return ev.hits > 0 || ev.complied > 0 || ev.corrections > 0 ? v : "unverifiable";
  return ev.hits > 0 ? v : "unverifiable"; /* touched */
}
