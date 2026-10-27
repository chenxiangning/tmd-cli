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
import { discriminativeTokens, measureAll, normalizeCmd } from "./evidence";
import { buildJudgeInstruction, parseJudgeReply, runJudgeRaw } from "./aiJudge";
import { parseRecognizeReply, buildRecognizeInstruction } from "./recognizePrompt";
import { buildStaticFindings } from "./staticFindings";
import { loadStore } from "./lintStore";
import {
  settledSig, type AiMark, type LintRow, type LintScope, type LintSummary, type LintTarget, type RuleItem,
  type RuleJudgment, type SessionCorpus, type StaticFinding, VERDICT_ORDER,
} from "./lintTypes";

export const WINDOW_DAYS = 30;
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

/** 规则切批(同文件内连续 8 条批判定,idx 即批内对位 key)。 */
export function batchRules(rules: RuleItem[]): RuleItem[][] {
  const out: RuleItem[][] = [];
  for (let i = 0; i < rules.length; i += BATCH_SIZE) out.push(rules.slice(i, i + BATCH_SIZE));
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
    if (r.kind === "command" && r.tokens.length > 0 && !unjudgeable[i] && preCommit && cmd) {
      if (preCommit.includes(cmd) || preCommit.includes(normalizeCmd(cmd))) enforced.add(r.file + r.text);
    }
  });
  for (const f of rulesByFile) {
    const rows = f.rules.map((rule) => ({
      rule, evidence: evidences[flatRules.indexOf(rule)] ?? null, judgment: null as RuleJudgment | null,
      scope: scopeOf(f.target), settled: false,
    }));
    if (alive()) opts.onFileEvidence(scopeOf(f.target), f.target.absPath, rows);
  }
  if (!alive()) throw new Error("lint-cancelled");

  /* 第二步·AI:逐文件串完 识别批→判定批(行状态连续推进),引擎级失败 fail-fast */
  let engineError = "";
  const judgments = new Map<string, RuleJudgment>();
  const needAiOf = (f: (typeof rulesByFile)[number]) =>
    f.rules.filter((r) => !enforced.has(r.file + r.text));
  for (const f of rulesByFile) {
    if (engineError || !alive()) break;
    const fname = `${f.target.scope === "user" ? "全局/" : "项目/"}${f.target.absPath.split("/").pop() ?? ""}`;
    const label = f.target.scope === "project" ? "项目级规则文件" : "用户级全局规则文件";
    const needAi = needAiOf(f);
    /* 识别批:8 条/批,±6 行节选 + 全文件目录 */
    const recBatches = batchRules(needAi);
    for (let bi = 0; bi < recBatches.length; bi++) {
      if (engineError || !alive()) break;
      const batch = recBatches[bi]!;
      opts.onProgress({
        step: "recognize", detail: `${fname} 批 ${bi + 1}/${recBatches.length}`, done: bi * BATCH_SIZE, total: needAi.length,
      });
      try {
        const raw = await runJudgeRaw({
          engineId: opts.engineId,
          instruction: buildRecognizeInstruction(label, f.text, batch.map((r) => r.line)),
          model: opts.model, cwd: opts.cwd, workspaceId: opts.workspaceId,
          timeoutSeconds: opts.timeoutSeconds,
          onChunk: (liveText) => {
            if (alive()) opts.onProgress({ step: "recognize", detail: "", live: liveText.slice(-4000) });
          },
          onWait: (waitSec, liveBytes) => { if (alive()) opts.onProgress({ step: "recognize", detail: `${fname} 批 ${bi + 1}/${recBatches.length}`, live: "", waitSec, liveBytes }); },
        });
        const focus = new Set(batch.map((r) => r.line));
        const marks = new Map<number, AiMark>();
        for (const m of parseRecognizeReply(raw)) {
          if (!focus.has(m.line)) continue;
          marks.set(m.line, { recognizable: m.recognizable, reason: m.reason, rewrite: m.rewrite });
        }
        if (alive()) opts.onAiMarks(scopeOf(f.target), f.target.absPath, marks);
      } catch (e) {
        engineError = engineNote(String(e), opts.engineId, opts.timeoutSeconds);
      }
    }
    /* 判定批(同文件紧随识别,行状态待判定→判定中→已判定) */
    for (const batch of batchRules(needAiOf(f))) {
      if (engineError || !alive()) break;
      const pairs = batch.map((rule) => ({ rule, evidence: evidences[flatRules.indexOf(rule)]! }));
      const judgeList = pairs.filter((p) => !enforced.has(p.rule.file + p.rule.text));
      if (judgeList.length === 0) continue;
      opts.onProgress({
        step: "judge", detail: "", live: "", done: judgments.size, total: Math.max(1, flatRules.length - enforced.size),
      });
      try {
        const raw = await runJudgeRaw({
          engineId: opts.engineId,
          instruction: buildJudgeInstruction(judgeList, corpus.msgs.length > 0),
          model: opts.model, cwd: opts.cwd, workspaceId: opts.workspaceId,
          timeoutSeconds: opts.timeoutSeconds,
          onChunk: (liveText) => { if (alive()) opts.onProgress({ step: "judge", detail: "", live: liveText.slice(-4000) }); },
          onWait: (waitSec, liveBytes) => { if (alive()) opts.onProgress({ step: "judge", detail: "", live: "", waitSec, liveBytes }); },
        });
        const parsed = parseJudgeReply(raw, judgeList.length);
        const patch: { scope: LintScope; file: string; rule: RuleItem; judgment: RuleJudgment }[] = [];
        parsed.forEach((j, i) => {
          if (!j) return;
          judgments.set(judgeList[i]!.rule.file + judgeList[i]!.rule.text, j);
          patch.push({ scope: scopeOf(f.target), file: judgeList[i]!.rule.file, rule: judgeList[i]!.rule, judgment: j });
        });
        if (alive() && patch.length > 0) opts.onJudgments(patch);
        if (parsed.every((j) => j === null)) {
          engineError = "引擎回复无有效判定(检查引擎登录/模型名)";
          break;
        }
      } catch (e) {
        engineError = engineNote(String(e), opts.engineId, opts.timeoutSeconds);
      }
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

function engineNote(msg: string, engineId: string, timeoutSeconds: number): string {
  if (msg.includes("judge-timeout")) return `判定超时(单批 ${timeoutSeconds}s);可换更快的引擎`;
  if (msg.includes("judge-engine-missing")) return `引擎 ${engineId} 不可用(command not found)`;
  return `判定失败:${msg.slice(0, 120)}`;
}

export type { SessionCorpus };
