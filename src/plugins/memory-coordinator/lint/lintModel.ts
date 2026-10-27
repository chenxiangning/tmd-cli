/**
 * 体检编排 —— 六步管线:定目标 → 读规则 → 采语料 → 测证据 → AI 批判定 →
 * 汇总(移植 tmd-lint engine.rs 骨架,判定步换成大模型语义判断)。
 *
 * 确定性先行的两类不烧模型:机器把关(pre-commit 已含规则命令=硬事实,直接
 * 判 working)、已拍板(本地指纹折叠)。AI 批判定 fail-fast:超时/引擎缺失/
 * 整批无效回复即中止剩余批次并上抛 engineError(此前静默吞掉,八批挨个超时
 * 假死,是「点了体检没反应」的根源之一)。可取消:新体检令牌作废旧跑。
 */

import { ipc } from "@kernel/ipc";
import { host } from "@kernel/host";
import { userHome } from "./home";
import { expandLintTargets, probeTargets } from "./targets";
import { extractRules } from "./rulesExtract";
import { collectCorpus } from "./corpus";
import { discriminativeTokens, measureAll, normalizeCmd } from "./evidence";
import { buildJudgeInstruction, parseJudgeReply, runJudgeRaw } from "./aiJudge";
import { buildStaticFindings } from "./staticFindings";
import { loadStore, saveLastResult } from "./lintStore";
import {
  settledSig, type LintRow, type LintTarget, type RuleItem, type RuleJudgment,
  type SessionCorpus, type StaticFinding, VERDICT_ORDER,
} from "./lintTypes";

export const WINDOW_DAYS = 30;
export const BATCH_SIZE = 8;
const CORPUS_BUDGET_MS = 90_000;

export interface LintProgress {
  step: "targets" | "corpus" | "evidence" | "judge" | "done";
  detail: string;
  /** AI 流式尾窗(仅 judge 步)。 */
  live?: string;
  done?: number;
  total?: number;
}

export interface LintRunResult {
  at: number;
  cwd: string;
  targets: LintTarget[];
  rows: LintRow[];
  findings: StaticFinding[];
  corpus: Pick<SessionCorpus, "sessionCount" | "readFiles"> & { msgs: number; calls: number };
  /** AI 批次失败数(判定为 null 的规则来源)。 */
  failedBatches: number;
  /** 引擎级失败(超时/缺失/无效回复)——中止批判定的原因,展示用;空串=无。 */
  engineError: string;
  /** 有 .bak-tmdlint 备份的规则文件(恢复入口数据源)。 */
  backups: string[];
}

export interface LintRunOpts {
  cwd: string;
  workspaceId: string | null;
  engineId: string;
  model: string | null;
  timeoutSeconds: number;
  onProgress: (p: LintProgress) => void;
}

let runSeq = 0;

/** 汇总行数(汇总条展示;failed = 判定缺失)。 */
export function summarizeRows(rows: LintRow[]): { verdicts: Record<string, number>; failed: number; settled: number } {
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

export async function runLint(opts: LintRunOpts): Promise<LintRunResult> {
  const token = ++runSeq;
  const alive = () => token === runSeq;
  const cutoffMs = Date.now() - WINDOW_DAYS * 24 * 3600 * 1000;

  /* 1. 定目标(声明式去重 + 探活) */
  opts.onProgress({ step: "targets", detail: "" });
  const home = await userHome();
  const all = expandLintTargets(host.getCliProfiles(), opts.cwd, home);
  const probe = await probeTargets(all.map((t) => t.absPath));
  const targets = all.map((t) => ({ ...t, exists: probe[t.absPath] ?? false })).filter((t) => t.exists);
  if (!alive()) throw new Error("lint-cancelled");

  /* 2. 读规则(各文件独立并行读;失败文件本轮跳过,下轮重体检) */
  const settledList = await Promise.all(
    targets.map(async (target) => {
      try {
        const text = await ipc.fsReadFile(target.absPath);
        const rules = extractRules(text, target.absPath).map((r, i) => ({ ...r, idx: i + 1 }));
        return { target, rules, text };
      } catch {
        return null;
      }
    }),
  );
  const rulesByFile = settledList.filter((f): f is { target: LintTarget; rules: RuleItem[]; text: string } => f !== null);
  if (!alive()) throw new Error("lint-cancelled");

  /* 3. 采语料(90s 预算 + 逐会话进度;千会话仓全量读会假死,到点即止用部分语料) */
  const corpus = await collectCorpus({
    profiles: host.getCliProfiles(),
    cwd: opts.cwd,
    cutoffMs,
    budgetMs: CORPUS_BUDGET_MS,
    onSession: (done, total, profileId) => {
      if (alive()) opts.onProgress({ step: "corpus", detail: `${profileId} ${done}/${total}` });
    },
  });
  if (!alive()) throw new Error("lint-cancelled");

  /* 4. 测证据 + 机器把关先判(pre-commit 硬事实) */
  opts.onProgress({ step: "evidence", detail: String(corpus.msgs.length) });
  const flatRules = rulesByFile.flatMap((f) => f.rules);
  const { byRule, unjudgeable } = discriminativeTokens(flatRules, corpus.msgs);
  const evidences = measureAll(flatRules, byRule, unjudgeable, corpus);
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
  if (!alive()) throw new Error("lint-cancelled");

  /* 5. AI 批判定(fail-fast:引擎级失败中止剩余批次,不再八批挨个超时) */
  const judgments = new Map<string, RuleJudgment>();
  let engineError = "";
  let cursor = 0;
  for (const f of rulesByFile) {
    if (engineError) break;
    for (const batch of batchRules(f.rules)) {
      const pairs = batch.map((rule, i) => ({ rule, evidence: evidences[cursor + i]! }));
      cursor += batch.length;
      const needAi = pairs.filter((p) => !enforced.has(p.rule.file + p.rule.text));
      if (needAi.length === 0) continue;
      if (!alive()) throw new Error("lint-cancelled");
      opts.onProgress({
        step: "judge", detail: "", live: "",
        done: judgments.size, total: Math.max(1, flatRules.length - enforced.size),
      });
      try {
        const raw = await runJudgeRaw({
          engineId: opts.engineId,
          instruction: buildJudgeInstruction(needAi, corpus.msgs.length > 0),
          model: opts.model,
          cwd: opts.cwd,
          workspaceId: opts.workspaceId,
          timeoutSeconds: opts.timeoutSeconds,
          onChunk: (liveText) => {
            if (alive()) opts.onProgress({ step: "judge", detail: "", live: liveText.slice(-4000) });
          },
        });
        const parsed = parseJudgeReply(raw, needAi.length);
        parsed.forEach((j, i) => {
          if (j) judgments.set(needAi[i]!.rule.file + needAi[i]!.rule.text, j);
        });
        if (parsed.every((j) => j === null)) {
          engineError = "引擎回复无有效判定(检查引擎登录/模型名)";
          break;
        }
      } catch (e) {
        const msg = String(e);
        engineError = msg.includes("judge-timeout")
          ? `判定超时(单批 ${opts.timeoutSeconds}s);可换更快的引擎或减小批量`
          : msg.includes("judge-engine-missing")
            ? `引擎 ${opts.engineId} 不可用(command not found)`
            : `判定失败:${msg.slice(0, 120)}`;
        break;
      }
    }
  }

  /* 6. 汇总:组装行 + 已拍板折叠 + 静态发现 + 备份探针 */
  const handled = new Set((await loadStore()).handled);
  let cursor2 = 0;
  const rows: LintRow[] = [];
  for (const f of rulesByFile) {
    for (const rule of f.rules) {
      const evidence = evidences[cursor2++]!;
      let judgment = judgments.get(rule.file + rule.text) ?? null;
      if (enforced.has(rule.file + rule.text)) {
        judgment = { verdict: "working", reason: "pre-commit 钩子已含该规则命令,机器把关", advice: "keep" };
      }
      const settled =
        (judgment?.verdict === "violated" || judgment?.verdict === "dormant") &&
        handled.has(settledSig(judgment.verdict, rule));
      rows.push({ rule, evidence, judgment, settled });
    }
  }
  const [repoFiles, bakProbe] = await Promise.all([
    ipc.fsWalkFiles(opts.cwd, 5000).catch(() => [] as string[]),
    probeTargets(targets.map((t) => `${t.absPath}.bak-tmdlint`)),
  ]);
  const findings = await buildStaticFindings({ cwd: opts.cwd, rulesByFile, msgs: corpus.msgs, repoFiles });
  const backups = targets.filter((t) => bakProbe[`${t.absPath}.bak-tmdlint`]).map((t) => t.absPath);
  if (!alive()) throw new Error("lint-cancelled");

  const result: LintRunResult = {
    at: Date.now(), cwd: opts.cwd, targets, rows, findings,
    corpus: { sessionCount: corpus.sessionCount, readFiles: corpus.readFiles, msgs: corpus.msgs.length, calls: corpus.calls.length },
    failedBatches: rows.filter((r) => !r.judgment).length,
    engineError,
    backups,
  };
  await saveLastResult(result);
  opts.onProgress({ step: "done", detail: "" });
  return result;
}
