/**
 * 体检编排(流水线版)—— 两步闭环:
 *  第一步 脚本扫描:定目标 → 读规则(逐文件即时上屏,证据待测)→ 采语料
 *        (90s 预算+逐会话进度,一次采集双口径分束:项目=cwd 全等会话,全局=全部)
 *        → 测证据(逐文件注入)→ 静态发现;
 *  第二步 AI 检测:识别 pass(规则文件全文带行号完整发模型,逐条问「能否识别
 *        并遵守」,不可识别给改写建议)+ 生效判定 pass(8 条一批,逐批回填)。
 *
 * 一切经 events 增量上报(controller 据此打补丁,右栏/中央报告实时生长);
 * 引擎级失败 fail-fast 中止剩余 AI 并上抛原因。可取消:新体检令牌作废旧跑。
 */

import { ipc } from "@kernel/ipc";
import { host } from "@kernel/host";
import { userHome } from "./home";
import { expandLintTargets, probeTargets } from "./targets";
import { extractRules } from "./rulesExtract";
import { collectCorpus, type CorpusProfileSource } from "./corpus";
import { discriminativeTokens, enforceVerdictContract, measureAll, normalizeCmd } from "./evidence";
import { buildUnifiedInstruction, parseUnifiedReply } from "./unifiedCall";
import { engineNote, runJudgeRaw } from "./aiJudge";
import { buildStaticFindings } from "./staticFindings";
import { loadStore } from "./lintStore";
import {
  settledSig, type AiMark, type LintRow, type LintScope, type LintSummary, type LintTarget, type RuleItem,
  type RuleJudgment, type SessionCorpus, type StaticFinding, VERDICT_ORDER,
} from "./lintTypes";

export const WINDOW_DAYS = 30;
/** 批默认大小(8;单调用后仅 batchRules 兜底/测试用)。 */
export const BATCH_SIZE = 8;
const CORPUS_BUDGET_MS = 90_000;

export interface LintProgress {
  step: "targets" | "corpus" | "evidence" | "recognize" | "judge" | "done";
  detail: string;
  live?: string;
  done?: number;
  total?: number;
  /** 等待心跳(runJudgeRaw onWait 透传):已等待秒数 / 引擎累计输出字节。 */
  waitSec?: number; liveBytes?: number;
}

export interface LintRunResult {
  at: number;
  cwd: string;
  targets: LintTarget[];
  rows: LintRow[];
  findings: StaticFinding[];
  corpus: { sessionCount: number; readFiles: number; msgs: number; calls: number };
  failedBatches: number;
  engineError: string;
  backups: string[];
}

export interface LintRunOpts {
  cwd: string;
  workspaceId: string | null;
  engineId: string;
  model: string | null;
  timeoutSeconds: number;
  scopes: LintScope[];
  onProgress: (p: LintProgress) => void;
  /** 行即时上屏(证据待测)。 */
  onFileRows: (scope: LintScope, file: string, rows: LintRow[]) => void;
  /** 证据注入(整文件替换)。 */
  onFileEvidence: (scope: LintScope, file: string, rows: LintRow[]) => void;
  /** AI 识别标记回填(按行号)。 */
  onAiMarks: (scope: LintScope, file: string, marks: Map<number, AiMark>) => void;
  /** 生效判定逐批回填(按 文件+行号 锚定)。 */
  onJudgments: (batch: { scope: LintScope; file: string; rule: RuleItem; judgment: RuleJudgment }[]) => void;
  onFindings: (findings: StaticFinding[]) => void;
  /** 幕布旁路通知(批解析失败等软事件,不 fail-fast)。 */
  onNotice?: (text: string) => void;
}

let runSeq = 0;

export function summarizeRows(rows: LintRow[]): LintSummary {
  const verdicts: Record<string, number> = {};
  for (const v of VERDICT_ORDER) verdicts[v] = 0;
  let failed = 0;
  let settled = 0;
  for (const r of rows) {
    if (r.settled) settled += 1;
    else if (!r.judgment) failed += 1;
    else verdicts[r.judgment.verdict] += 1;
  }
  return { verdicts, failed, settled };
}

/** 规则切批(同文件内连续 size 条;默认 BATCH_SIZE)。 */
export function batchRules(rules: RuleItem[], size = BATCH_SIZE): RuleItem[][] {
  const out: RuleItem[][] = [];
  for (let i = 0; i < rules.length; i += size) out.push(rules.slice(i, i + size));
  return out;
}

function sameDir(a: string | null, b: string): boolean {
  return a !== null && a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

export async function runLintStream(opts: LintRunOpts): Promise<LintRunResult> {
  const token = ++runSeq;
  const alive = () => token === runSeq;
  const cutoffMs = Date.now() - WINDOW_DAYS * 24 * 3600 * 1000;
  const scopeOf = (t: LintTarget): LintScope => (t.scope === "user" ? "global" : "project");

  /* 第一步·定目标+读规则:逐文件即时上屏(证据待测),已拍板先折叠 */
  opts.onProgress({ step: "targets", detail: "" });
  const home = await userHome();
  const scopeSet = new Set<LintScope>(opts.scopes);
  const all = expandLintTargets(host.getCliProfiles(), opts.cwd, home).filter((t) => scopeSet.has(scopeOf(t)));
  const probe = await probeTargets(all.map((t) => t.absPath));
  const targets = all.map((t) => ({ ...t, exists: probe[t.absPath] ?? false })).filter((t) => t.exists);
  const handled = new Set((await loadStore()).handled);
  const rulesByFile: { target: LintTarget; rules: RuleItem[]; text: string }[] = [];
  for (const target of targets) {
    if (!alive()) throw new Error("lint-cancelled");
    try {
      const text = await ipc.fsReadFile(target.absPath);
      const rules = extractRules(text, target.absPath).map((r, i) => ({ ...r, idx: i + 1 }));
      rulesByFile.push({ target, rules, text });
      opts.onFileRows(
        scopeOf(target),
        target.absPath,
        rules.map((rule) => ({
          rule, evidence: null, judgment: null, scope: scopeOf(target),
          settled: handled.has(settledSig("violated", rule)) || handled.has(settledSig("dormant", rule)),
        })),
      );
    } catch {
      /* 读失败 = 本轮跳过该文件(下轮重体检) */
    }
  }

  /* 第一步·采语料:一次采集,项目口径按 sessionCwds 分束(全局=全部) */
  const corpus = await collectCorpus({
    profiles: host.getCliProfiles() as unknown as CorpusProfileSource[],
    cwd: opts.cwd,
    cutoffMs,
    budgetMs: CORPUS_BUDGET_MS,
    onSession: (done, total, profileId) => { if (alive()) opts.onProgress({ step: "corpus", detail: `${profileId} ${done}/${total}` }); },
  });
  if (!alive()) throw new Error("lint-cancelled");
  const projSet = new Set<number>();
  corpus.sessionCwds.forEach((c, idx) => {
    if (sameDir(c, opts.cwd)) projSet.add(idx);
  });
  const hasCorpus = corpus.msgs.length > 0;

  /* 第一步·测证据:逐文件注入(项目规则用项目会话束,全局规则用全部) */
  opts.onProgress({ step: "evidence", detail: String(corpus.msgs.length) });
  const flatRules = rulesByFile.flatMap((f) => f.rules);
  const { byRule, unjudgeable } = discriminativeTokens(flatRules, corpus.msgs);
  const evidences = measureAll(flatRules, byRule, unjudgeable, corpus, (rule) =>
    rulesByFile.find((f) => f.target.absPath === rule.file)?.target.scope === "project" ? projSet : null,
  );
  let preCommit = "";
  try {
    preCommit = await ipc.fsReadFile(`${opts.cwd}/.git/hooks/pre-commit`);
  } catch {
    preCommit = "";
  }
  const enforced = new Set<string>();
  flatRules.forEach((r, i) => {
    const cmd = evidences[i]!.command;
    if (r.kind === "command" && r.tokens.length > 0 && !unjudgeable[i] && preCommit && cmd
      && (preCommit.includes(cmd) || preCommit.includes(normalizeCmd(cmd)))) enforced.add(r.file + r.text);
  });
  for (const f of rulesByFile) {
    const rows = f.rules.map((rule) => ({
      rule, evidence: evidences[flatRules.indexOf(rule)] ?? null, judgment: null as RuleJudgment | null,
      scope: scopeOf(f.target), settled: false,
    }));
    if (alive()) opts.onFileEvidence(scopeOf(f.target), f.target.absPath, rows);
  }
  if (!alive()) throw new Error("lint-cancelled");

  /* 第二步·AI:单次调用(用户裁决:一次体检只许 1 次模型调用)——
   * 发全部规则+脚本测量,一次回全部 识别标记+判定;解析缺行=未判定,缺口在幕布明报。 */
  let engineError = "";
  const judgments = new Map<string, RuleJudgment>();
  const uni = rulesByFile.flatMap((f) =>
    f.rules
      .filter((r) => !enforced.has(r.file + r.text))
      .map((rule) => ({ rule, evidence: evidences[flatRules.indexOf(rule)]!, scope: scopeOf(f.target) })),
  );
  if (uni.length > 0) {
    opts.onProgress({ step: "judge", detail: "单次调用", live: "", done: 0, total: uni.length });
    const askOnce = () =>
      runJudgeRaw({
        engineId: opts.engineId,
        instruction: buildUnifiedInstruction(uni.map((p) => ({ rule: p.rule, evidence: p.evidence })), hasCorpus),
        model: opts.model, cwd: opts.cwd, workspaceId: opts.workspaceId,
        timeoutSeconds: opts.timeoutSeconds,
        onChunk: (liveText) => {
          if (alive()) opts.onProgress({ step: "judge", detail: "", live: liveText.slice(-4000) });
        },
        onWait: (waitSec, liveBytes) => {
          if (alive()) opts.onProgress({ step: "judge", detail: "单次调用", live: "", waitSec, liveBytes, done: judgments.size, total: uni.length });
        },
      });
    try {
      let raw = await askOnce();
      let items = parseUnifiedReply(raw, uni.length - 1);
      if (items.length === 0) {
        opts.onNotice?.("[ai] 单次调用解析为空,重试 1 次");
        raw = await askOnce();
        items = parseUnifiedReply(raw, uni.length - 1);
      }
      if (alive()) {
        const marksByFile = new Map<string, { scope: LintScope; marks: Map<number, AiMark> }>();
        const patch: { scope: LintScope; file: string; rule: RuleItem; judgment: RuleJudgment }[] = [];
        const hitIdx = new Set<number>();
        for (const it of items) {
          const slot = uni[it.i];
          if (!slot) continue;
          hitIdx.add(it.i);
          const entry = marksByFile.get(slot.rule.file) ?? { scope: slot.scope, marks: new Map<number, AiMark>() };
          entry.marks.set(slot.rule.line, { recognizable: it.ok, reason: it.why, rewrite: it.fix });
          marksByFile.set(slot.rule.file, entry);
          const key = slot.rule.file + slot.rule.text;
          if (!judgments.has(key)) {
            /* advice 单调用协议不再由模型给:不可执行规则给 stub(改写文本走 aiMark.rewrite),其余 keep。 */
            const j: RuleJudgment = { verdict: enforceVerdictContract(it.v, slot.evidence, hasCorpus), reason: it.why, advice: it.ok ? "keep" : "stub", fix: it.fix };
            judgments.set(key, j);
            patch.push({ scope: slot.scope, file: slot.rule.file, rule: slot.rule, judgment: j });
          }
        }
        for (const [file, { scope, marks }] of marksByFile) opts.onAiMarks(scope, file, marks);
        if (patch.length > 0) opts.onJudgments(patch);
        const missing = uni.length - hitIdx.size;
        opts.onNotice?.(`[ai] 单次调用回填 ${hitIdx.size}/${uni.length}${missing > 0 ? ` · 未解析 ${missing} 条(未判定,不猜测)` : ""}`);
      }
    } catch (e) {
      engineError = engineNote(String(e), opts.engineId, opts.timeoutSeconds);
    }
  }

  /* 汇总:行组装(含 enforced/settled)+ 静态发现 + 备份探针 */
  const rows: LintRow[] = rulesByFile.flatMap((f) => {
    const scope = scopeOf(f.target);
    return f.rules.map((rule) => {
      const evidence = evidences[flatRules.indexOf(rule)] ?? null;
      let judgment = judgments.get(rule.file + rule.text) ?? null;
      if (enforced.has(rule.file + rule.text)) {
        judgment = { verdict: "working", reason: "pre-commit 钩子已含该规则命令,机器把关", advice: "keep" };
      }
      const settled =
        (judgment?.verdict === "violated" || judgment?.verdict === "dormant") &&
        handled.has(settledSig(judgment.verdict, rule));
      return { rule, evidence, judgment, settled, scope };
    });
  });
  const [repoFiles, bakProbe] = await Promise.all([
    ipc.fsWalkFiles(opts.cwd, 5000).catch(() => [] as string[]),
    probeTargets(targets.map((t) => `${t.absPath}.bak-tmdlint`)),
  ]);
  const findings = await buildStaticFindings({ cwd: opts.cwd, rulesByFile, msgs: corpus.msgs, repoFiles });
  if (alive()) opts.onFindings(findings);
  const backups = targets.filter((t) => bakProbe[`${t.absPath}.bak-tmdlint`]).map((t) => t.absPath);
  if (!alive()) throw new Error("lint-cancelled");

  opts.onProgress({ step: "done", detail: "" });
  return {
    at: Date.now(), cwd: opts.cwd, targets, rows,
    findings,
    corpus: { sessionCount: corpus.sessionCount, readFiles: corpus.readFiles, msgs: corpus.msgs.length, calls: corpus.calls.length },
    failedBatches: rows.filter((r) => !r.judgment).length,
    engineError,
    backups,
  };
}

export type { SessionCorpus };
