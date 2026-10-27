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
  /** 幕布事件流:脚本侧确定性事件(与引擎 PTY 输出无关,保证实时可见)。 */
  log: LintLogEntry[];
  /** 上次心跳秒数(去重打点)。 */
  waitSec: number;
}

export interface LintLogEntry {
  id: number;
  text: string;
}

let state: LintControllerState = { running: false, progress: null, result: null, error: "", log: [], waitSec: 0 };
const listeners = new Set<() => void>();
let logSeq = 0;

function commit(next: Partial<LintControllerState>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

/** 幕布事件:时间戳 + 消息,cap 240 条(旧的去)。 */
function logLine(msg: string): void {
  const ts = new Date().toTimeString().slice(0, 8);
  state = { ...state, log: [...state.log, { id: ++logSeq, text: `[${ts}] ${msg}` }].slice(-240) };
  for (const l of listeners) l();
}

/** 供 lintModel 把批级事件写进幕布(onJudgments/onAiMarks 等回调透传)。 */
export const emitLintEvent = logLine;

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
  state = { ...state, log: [], waitSec: 0 };
  commit({ running: true, progress: { step: "targets", detail: "" }, error: "", result: null });
  logLine(`[start] ${opts.engineId}${opts.model ? ` · ${opts.model}` : ""} · 超时 1200s`);
  void (async () => {
    try {
      const result = await runLintStream({
        cwd: opts.cwd, workspaceId: opts.workspaceId, engineId: opts.engineId,
        model: opts.model, timeoutSeconds: 1200, scopes: opts.scopes,
        onProgress: (p) => {
          const prev = state.progress?.step;
          commit({ progress: p });
          if (p.waitSec !== undefined && p.waitSec !== state.waitSec) {
            state = { ...state, waitSec: p.waitSec };
            const phase = p.step === "recognize" ? `识别中 ${p.detail}` : "判定中";
            logLine(`[wait] ${phase} · 已等 ${p.waitSec}s · 引擎输出 ${p.liveBytes ?? 0} 字节`);
            return;
          }
          if (p.step !== prev) {
            const label = p.step === "corpus" ? `读对话语料${p.detail ? ` · ${p.detail}` : ""}`
              : p.step === "evidence" ? `抽证据${p.detail ? ` · ${p.detail} 条消息` : ""}`
              : p.step === "recognize" ? "AI 识别 pass(全文比对)"
              : p.step === "judge" ? `AI 判定 ${p.done ?? 0}/${p.total ?? 0}`
              : p.step === "done" ? "流水线完成" : "读规则文件";
            logLine(`[${p.step}] ${label}`);
          } else if (p.step === "judge" && p.done !== state.progress?.done) {
            logLine(`[judge] ${p.done ?? 0}/${p.total ?? 0}`);
          }
        },
        onFileRows: (scope, _file, rows) => {
          logLine(`[script] ${scope === "global" ? "全局" : "项目"} ${rows[0]?.rule.file.split("/").pop() ?? _file} 提取 ${rows.length} 条规则`);
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
          const ok = [...marks.values()].filter((m) => m.recognizable).length;
          logLine(`[recognize] ${scope === "global" ? "全局" : "项目"} ${file.split("/").pop()} 可识别 ${ok} / 不可 ${marks.size - ok}`);
          patchRows(file, (row) => {
            const mark = marks.get(row.rule.line);
            return mark ? { ...row, aiMark: mark, scope } : row;
          });
        },
        onJudgments: (batch) => {
          const b0 = batch[0];
          logLine(`[judge] ${b0 ? (b0.scope === "global" ? "全局" : "项目") : ""} ${b0?.file.split("/").pop() ?? ""} 批返回 ${batch.length} 条判定`);
          for (const b of batch) {
            patchRows(b.file, (row) => (row.rule === b.rule ? { ...row, judgment: b.judgment, scope: b.scope } : row));
          }
        },
        onFindings: (findings: StaticFinding[]) => {
          logLine(`[static] 确定性发现 ${findings.length} 条`);
          mutateLintResult((r) => ({ ...r, findings }));
        },
      });
      const s = summarizeRows(result.rows);
      logLine(`[done] 规则 ${result.rows.length} · 判定 ${result.rows.length - s.failed} · 失败 ${s.failed}${result.engineError ? ` · ${result.engineError}` : ""}`);
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
      logLine(`[error] ${msg}`);
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
