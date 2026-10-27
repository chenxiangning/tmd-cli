/**
 * 体检控制器(模块级单例)—— 右栏视图与中央报告 tab 共享同一份运行态。
 *
 * start() 起一次流水线,runLintStream 的增量事件实时打进 result 快照
 * (逐文件上屏 → 证据注入 → AI 识别标记回填 → 生效判定逐批回填 → 发现),
 * 订阅方(useSyncExternalStore)随之生长;结束落扫描记录。mutate 供动作
 * (拍板/重开/应用后)改结果态。openReport 打开/聚焦中央报告 tab。
 */

import { openTab, getTabs } from "@kernel/tabs";
import { t } from "@kernel/i18n";
import { runLintStream, summarizeRows, type LintProgress, type LintRunResult } from "./lintModel";
import { addScanRecord } from "./lintStore";
import type { LintRow, LintScope, StaticFinding } from "./lintTypes";

export interface LintControllerState {
  running: boolean;
  progress: LintProgress | null;
  result: LintRunResult | null;
  error: string;
}

let state: LintControllerState = { running: false, progress: null, result: null, error: "" };
const listeners = new Set<() => void>();

function commit(next: Partial<LintControllerState>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function subscribeLint(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLintState(): LintControllerState {
  return state;
}

/** 视图挂载时播种上次结果(同 cwd 才播;结果为空且未在跑时)。 */
export function seedLintResult(r: LintRunResult): void {
  if (state.result || state.running) return;
  commit({ result: r });
}

/** 动作后的结果态回写(拍板/重开/发现移除/应用刷新)。 */
export function mutateLintResult(fn: (r: LintRunResult) => LintRunResult): void {
  if (!state.result) return;
  commit({ result: fn(state.result) });
}

function patchRows(file: string, fn: (row: LintRow) => LintRow): void {
  if (!state.result) return;
  mutateLintResult((r) => ({ ...r, rows: r.rows.map((row) => (row.rule.file === file ? fn(row) : row)) }));
}

export interface LintStartOpts {
  cwd: string;
  workspaceId: string | null;
  engineId: string;
  model: string | null;
  scopes: LintScope[];
  onError?: (msg: string) => void;
}

/** 起一次体检(右栏/报告页共用);新跑作废旧跑。 */
export function startLint(opts: LintStartOpts): void {
  if (state.running) return;
  commit({ running: true, progress: { step: "targets", detail: "" }, error: "" });
  void (async () => {
    try {
      const result = await runLintStream({
        cwd: opts.cwd, workspaceId: opts.workspaceId, engineId: opts.engineId,
        model: opts.model, timeoutSeconds: 1200, scopes: opts.scopes,
        onProgress: (p) => commit({ progress: p }),
        onFileRows: (scope, _file, rows) => {
          if (!state.result) {
            commit({
              result: {
                at: Date.now(), cwd: opts.cwd, targets: [], rows: [], findings: [],
                corpus: { sessionCount: 0, readFiles: 0, msgs: 0, calls: 0 },
                failedBatches: 0, engineError: "", backups: [],
              },
            });
          }
          const known = new Map(state.result!.targets.map((t) => [t.absPath, t]));
          for (const row of rows) {
            if (!known.has(row.rule.file)) {
              known.set(row.rule.file, { absPath: row.rule.file, scope: scope === "global" ? "user" : "project", engines: [], exists: true });
            }
          }
          mutateLintResult((r) => ({ ...r, targets: [...known.values()], rows: [...r.rows, ...rows] }));
        },
        onFileEvidence: (scope, file, rows) => {
          patchRows(file, (row) => rows.find((x) => x.rule === row.rule) ?? { ...row, evidence: row.evidence, scope });
        },
        onAiMarks: (scope, file, marks) => {
          patchRows(file, (row) => {
            const mark = marks.get(row.rule.line);
            return mark ? { ...row, aiMark: mark, scope } : row;
          });
        },
        onJudgments: (batch) => {
          for (const b of batch) {
            patchRows(b.file, (row) => (row.rule === b.rule ? { ...row, judgment: b.judgment, scope: b.scope } : row));
          }
        },
        onFindings: (findings: StaticFinding[]) => mutateLintResult((r) => ({ ...r, findings })),
      });
      const s = summarizeRows(result.rows);
      await addScanRecord({
        at: result.at, cwd: result.cwd, engineId: opts.engineId, model: opts.model ?? "",
        files: new Set(result.rows.map((r) => r.rule.file)).size, rules: result.rows.length,
        judged: result.rows.length - s.failed, failed: s.failed, findings: result.findings.length,
        corpusMsgs: result.corpus.msgs, corpusSessions: result.corpus.sessionCount,
        aiBad: result.rows.filter((r) => r.aiMark && !r.aiMark.recognizable).length,
        engineError: result.engineError,
      });
      commit({ result, running: false, progress: null });
      if (result.engineError) {
        commit({ error: result.engineError });
        opts.onError?.(result.engineError);
      }
    } catch (e) {
      if (String(e).includes("lint-cancelled")) return;
      const msg = String(e).slice(0, 160);
      commit({ running: false, progress: null, error: msg });
      opts.onError?.(msg);
    }
  })();
}

/** 中止当前跑(新体检会自动作废旧跑;此处供显式取消)。 */
export function resetLint(): void {
  commit({ running: false, progress: null });
}

/** 中央报告 tab(唯一 id;已开则聚焦)。 */
export function openLintReport(scope?: LintScope): void {
  if (!getTabs().some((tab) => tab.id === "lint-report")) {
    openTab({
      id: "lint-report",
      title: t("规则体检报告"),
      path: "AGENTS.md / CLAUDE.md",
      kind: "lint-report",
      payload: { scope: scope ?? null },
    });
  }
}
