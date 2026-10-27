/**
 * AI 语义判定 —— 规则 + 证据包 → 大模型实时判定生效情况(tmd-lint 移植的核心替换点:
 * 独立版七态由「纠正 ≥2 次/触达 ≥1 次」阈值 if 链定罪,这里改为把证据包交给
 * 本机 CLI 一次性 print 会话做真实语义判断,证据原文随包附上供模型核对)。
 *
 * 引擎范式与 prompt-enhancer 同款(argv 表 2026-09-21 逐家 --help 实证,随其更新;
 * CLI 私有知识只落本文件):session_spawn 起 PTY → pty://out 流式 → 终局按
 * <LINT> 哨兵提取 JSON;结束自归档磁盘身份,不污染默认会话视图。
 */

import { ipc, onPtyExit, onPtyOutput } from "@kernel/ipc";
import { stripAnsi } from "@kernel/askDetect";
import { archiveSession, sessionArchiveKey } from "@kernel/sessionArchive";
import { host } from "@kernel/host";
import type { LintAdvice, RuleEvidence, RuleItem, RuleJudgment, LintVerdict } from "./lintTypes";
import { scriptVerdict } from "./evidence";

/** 引擎 argv 表(prompt-enhancer/enhanceEngines.ts 同源实证;改动须两边同步)。 */
export interface JudgeEngineAdapter {
  id: string;
  command: string;
  buildArgs(prompt: string, model: string | null): string[];
}

function modelArgs(flag: string, model: string | null): string[] {
  const m = model?.trim();
  return m ? [flag, m] : [];
}

export const JUDGE_ENGINES: JudgeEngineAdapter[] = [
  { id: "claude", command: "claude", buildArgs: (p, m) => ["-p", p, ...modelArgs("--model", m)] },
  { id: "codex", command: "codex", buildArgs: (p, m) => ["exec", "--skip-git-repo-check", ...modelArgs("-m", m), p] },
  { id: "omp", command: "omp", buildArgs: (p, m) => ["-p", ...modelArgs("--model", m), p] },
  { id: "pi", command: "pi", buildArgs: (p, m) => ["-p", ...modelArgs("--model", m), p] },
  { id: "opencode", command: "opencode", buildArgs: (p, m) => ["run", ...modelArgs("-m", m), p] },
  { id: "kimi", command: "kimi", buildArgs: (p, m) => ["-p", p, ...modelArgs("-m", m)] },
  { id: "qoder", command: "qoder", buildArgs: (p, m) => ["-p", p, ...modelArgs("-m", m)] },
  { id: "grok", command: "grok", buildArgs: (p, m) => ["--single", p, ...modelArgs("-m", m)] },
];

const KIND_LABEL: Record<string, string> = {
  command: "命令型", path: "路径型", prohibition: "禁令型",
  style: "风格型", process: "流程型", reference: "引用型", other: "一般",
};

const VERDICTS: LintVerdict[] = ["working", "violated", "touched", "dormant", "unverifiable"];
const ADVICES: LintAdvice[] = ["keep", "remove", "archive", "stub", "fixpath"];

const PRE_LABEL: Record<LintVerdict, string> = {
  working: "working 真的在做", violated: "violated AI 不听", touched: "touched 只是提到",
  dormant: "dormant 没人用", unverifiable: "unverifiable 说不清",
};

/** 脚本测量摘要(仅计数与脚本预判,不带对话原文/引文/信号词——控制 token,原文不出本机)。 */
function evidenceBlock(rule: RuleItem, ev: RuleEvidence, hasSessions: boolean): string {
  const day = ev.lastSeen ? new Date(ev.lastSeen).toISOString().slice(0, 10) : "无";
  const lines = [
    `[${rule.idx}] (${KIND_LABEL[rule.kind] ?? rule.kind} | 章节:${rule.section})`,
    `规则原文:${rule.text.replace(/\n+/g, " ⏎ ")}`,
    `脚本测量:触达 ${ev.hits} 条消息 / ${ev.activeSessions} 个会话,最近 ${day};纠正 ${ev.corrections} 次;工具级照做 ${ev.complied} 次${ev.unjudgeable ? ";词面证据不可用" : ""}`,
    `脚本预判:${PRE_LABEL[scriptVerdict(ev, hasSessions)]}(仅按上表计数得出,供参考)`,
  ];
  if (ev.command) lines.push(`规则内命令:${ev.command}(照做=计数里确实跑过)`);
  return lines.join("\n");
}

/** 组装批判定指令:规则原文 + 脚本测量摘要(计数+脚本预判),AI 给最终判定。 */
export function buildJudgeInstruction(
  batch: { rule: RuleItem; evidence: RuleEvidence }[],
  hasSessions: boolean,
): string {
  return [
    "你是 AI 助手规则文件的体检官。下面每条规则只附一份「脚本测量摘要」——脚本先在本机近 30 天会话上算好计数(触达/纠正/工具级照做)并给出确定性预判;对话原文不会发给你。请结合规则文本与这些计数,给出你最终的生效判定。",
    "",
    "判定取值(v,五选一):",
    '- "working" 真的在做:证据显示规则被执行(命令被真实跑过/路径确实按规则落盘;禁令型被反复触达且未观测到违反也算)',
    '- "violated" AI 不听:用户当场纠正过,且纠正话术表明此前做法违背该规则(纠正 1 次即算;纠正后已改正的按证据取 working/touched)',
    '- "touched" 只是提到:有词面触达,但无照做证据也无违反记录',
    '- "dormant" 没人用:窗口内会话与调用零触达(零触达 + 信号词可用才可判此值)',
    '- "unverifiable" 说不清:信号词缺失或全部超高频、语料为空等,证据不足以下结论(明说,不装懂)',
    "",
    "建议动作(a,四选一):keep 保持 / remove 删除该规则 / archive 归档到 docs/agents-archive.md / stub 本文件收口为 stub(仅当规则文件与 AGENTS.md 内容重复时)。默认 keep;拿不准也 keep。",
    "",
    "诚实铁律:只按证据判断,禁止脑补;纠正 0 次不得判 violated;零触达不得判 working;证据不足判 unverifiable。",
    hasSessions ? "" : "(注意:本次语料为空,所有动态证据缺失,除确有把握者外倾向 unverifiable)",
    "",
    "输出契约:把结果完整包在 <LINT> 与 </LINT> 标记之间,内容是一个 JSON 数组,每条:",
    '{"i": 规则序号数字, "v": "判定", "r": "一句话中文理由", "a": "建议动作"}',
    "标记之外不要输出任何内容(不要解释、不要代码围栏)。",
    "",
    "=== 规则与证据 ===",
    ...batch.map(({ rule, evidence }) => `${evidenceBlock(rule, evidence, hasSessions)}\n`),
  ].join("\n");
}

const OPEN = "<LINT>";
const CLOSE = "</LINT>";

function sanitizeReason(r: unknown): string {
  return typeof r === "string" ? r.replace(/\s+/g, " ").trim().slice(0, 200) : "";
}

/** 模型回复 → 逐条判定(哨兵内 JSON 优先;坏项跳过不连坐;缺项=调用方标失败)。 */
export function parseJudgeReply(raw: string, count: number): (RuleJudgment | null)[] {
  const text = stripAnsi(raw);
  const m = text.match(new RegExp(`${OPEN}([\\s\\S]*?)${CLOSE}`));
  const body = m ? m[1]!.trim() : "";
  const out: (RuleJudgment | null)[] = Array.from({ length: count }, () => null);
  const tryItem = (v: unknown) => {
    if (typeof v !== "object" || v === null) return;
    const o = v as Record<string, unknown>;
    const i = typeof o.i === "number" ? o.i : Number.parseInt(String(o.i ?? ""), 10);
    if (!Number.isInteger(i) || i < 1 || i > count) return;
    const verdict = VERDICTS.find((x) => x === o.v);
    if (!verdict) return;
    const advice = ADVICES.find((x) => x === o.a) ?? "keep";
    out[i - 1] = { verdict, reason: sanitizeReason(o.r), advice };
  };
  const tryParse = (s: string): boolean => {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) {
        arr.forEach(tryItem);
        return true;
      }
    } catch { /* 整段解析失败走逐对象捞 */ }
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

export interface JudgeRunOpts {
  engineId: string;
  instruction: string;
  model: string | null;
  cwd: string;
  workspaceId: string | null;
  timeoutSeconds: number;
  onChunk?: (liveText: string) => void;
  /** 等待心跳:每 15s 报一次已等待秒数与引擎累计输出字节(引擎可能整段缓冲)。 */
  onWait?: (waitedSec: number, outputBytes: number) => void;
}

/** 剥 ANSI/控制符 + 压空行(与 prompt-enhancer normalizePtyText 同一件)。 */
export function normalizePtyText(text: string): string {
  return stripAnsi(text)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 起一次 PTY 判定会话并等终局,返回全量清洗文本;超时杀进程后按超时计。
 *  订阅与 prompt-enhancer 同款:exit 后 Rust watcher 自清理句柄,无需退订。 */
export async function runJudgeRaw(opts: JudgeRunOpts): Promise<string> {
  const engine = JUDGE_ENGINES.find((e) => e.id === opts.engineId) ?? JUDGE_ENGINES[0]!;
  const spawned = await ipc.sessionSpawn(
    engine.id,
    { command: engine.command, args: engine.buildArgs(opts.instruction, opts.model), cwd: opts.cwd },
    opts.workspaceId ?? undefined,
  );
  let live = "";
  let timedOut = false;
  let settled = false;
  const startedAt = Date.now();
  const heart = setInterval(() => {
    if (!settled) opts.onWait?.(Math.round((Date.now() - startedAt) / 1000), live.length);
  }, 5000);
  const { promise, resolve } = Promise.withResolvers<string>();
  void onPtyOutput(spawned.id, (chunk) => {
    live += chunk;
    opts.onChunk?.(normalizePtyText(live));
  });
  const timer = setTimeout(() => {
    timedOut = true;
    void ipc.sessionKill(spawned.id).catch(() => {});
  }, Math.max(5, opts.timeoutSeconds) * 1000);
  void onPtyExit(spawned.id, () => {
    if (settled) return;
    settled = true;
    clearInterval(heart);
    clearTimeout(timer);
    resolve(normalizePtyText(live));
  });
  const raw = await promise;
  if (timedOut) throw new Error("judge-timeout");
  /* 仅当输出极短时才把 command not found 当引擎缺失;长回复里含该词是引擎/模型内容,不误判。 */
  if (live.length < 200 && /command not found/i.test(raw)) throw new Error("judge-engine-missing");
  void archiveSpawnedDiskSession(engine.id, opts.cwd, opts.workspaceId).catch(() => {});
  return raw;
}

/** 判定会话自归档(prompt-enhancer 同款):按磁盘身份找 spawn 后新落盘会话归档。 */
async function archiveSpawnedDiskSession(engineId: string, cwd: string, workspaceId: string | null): Promise<void> {
  if (!workspaceId) return;
  const startedAt = Date.now() - 60_000;
  const fresh = await new Promise<string | null>((resolve) => {
    setTimeout(() => {
      const p = host.getCliProfile(engineId);
      p?.listSessions?.(cwd).then(
        (list) => resolve(list.filter((s) => Math.max(s.modifiedAt, s.createdAt ?? 0) >= startedAt).sort((a, b) => b.modifiedAt - a.modifiedAt)[0]?.id ?? null),
        () => resolve(null),
      );
    }, 800);
  });
  if (fresh) await archiveSession(sessionArchiveKey(workspaceId, engineId, fresh));
}

/** 引擎级错误文案(幕布/横幅共用)。 */
export function engineNote(msg: string, engineId: string, timeoutSeconds: number): string {
  if (msg.includes("judge-timeout")) return `判定超时(单批 ${timeoutSeconds}s);可换更快的引擎`;
  if (msg.includes("judge-engine-missing")) return `引擎 ${engineId} 不可用(command not found)`;
  return `判定失败:${msg.slice(0, 120)}`;
}
