/**
 * 规则体检报告(中央 tab,kind="lint-report")—— 完整闭环视图。
 *
 * 分区:项目规则 / 全局规则(各自目标文件 + 规则行 + 各自动作)、静态发现、
 * 扫描记录(每次体检)、应用记录(每次保存前后内容,可撤销可回看)。
 * 运行态与右栏视图同源(lintController 单例):体检在任一处启动,两边同时生长。
 * 选中规则右侧详情面板在 RuleDetailPanel.tsx(点规则行展开即联动)。
 */

import { useCallback, useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { ConfirmDialog } from "@kernel/DialogConfirm";
import { useWorkspaces } from "@kernel/workspace";
import { summarizeRows, type LintRunResult } from "./lintModel";
import { loadStore, setLastUsed } from "./lintStore";
import { seedLintResult, startLint } from "./lintController";
import { useLintApply, useLintController as useCtl, useLintResultWrite } from "./lintPanelState";
import { VERDICT_LABEL, type LintRow } from "./lintTypes";
import { FindingRow, RuleRow } from "./LintRows";
import { LintProcessing } from "./LintProcessing";
import { RuleDetailPanel } from "./RuleDetailPanel";
import { ApplyJournal, ScanHistory } from "./LintReportHistory";
import { ReportStats, ReportToolbar, type ScopeFilter } from "./LintReportChrome";

const SECTION_CLS = "border-y border-(--tmd-border) bg-(--tmd-bg-subtle) px-3 py-1 text-meta font-medium text-(--tmd-fg-muted)";

function reportPhase(running: boolean, step: string | undefined, hasResult: boolean) {
  if (running) return step === "recognize" || step === "judge" ? "ai" : "scan";
  return hasResult ? "review" : "scan";
}

/** 单个 scope 分区:文件分组规则行(行即时上屏由控制器驱动)。 */
function ScopeSection({
  title, rows, busy, onApply, onKeep, onHook, onReopen, onRewrite, onSelect,
}: {
  title: string;
  rows: LintRow[];
  busy: boolean;
  onApply: (row: LintRow, advice: Parameters<ReturnType<typeof useLintApply>["onApply"]>[1]) => void;
  onKeep: (row: LintRow) => void;
  onHook: (row: LintRow) => void;
  onReopen: (row: LintRow) => void;
  onRewrite: (row: LintRow) => void;
  onSelect: (row: LintRow) => void;
}) {
  if (rows.length === 0) return null;
  const byFile = new Map<string, LintRow[]>();
  for (const r of rows) byFile.set(r.rule.file, [...(byFile.get(r.rule.file) ?? []), r]);
  return (
    <div>
      <div className={SECTION_CLS}>
        {title}({rows.length})
      </div>
      {[...byFile.entries()].map(([file, list]) => (
        <div key={file}>
          <div className="flex items-center gap-2 px-3 py-0.5 text-meta text-(--tmd-fg-faint)">
            <span className="min-w-0 truncate font-mono">{file}</span>
          </div>
          {list.map((r) => (
            <RuleRow
              key={`${r.rule.file}:${r.rule.line}`} row={r} busy={busy}
              onApply={onApply} onKeep={onKeep} onHook={onHook} onReopen={onReopen} onRewrite={onRewrite} onSelect={onSelect}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function ReportBody({
  result, scopeFilter, busy, onApply, onKeep, onHook, onReopen, onRewrite, onStub, onWrite, onFixpath,
}: {
  result: LintRunResult;
  scopeFilter: ScopeFilter;
  busy: boolean;
  onApply: (row: LintRow, advice: Parameters<ReturnType<typeof useLintApply>["onApply"]>[1]) => void;
  onKeep: (row: LintRow) => void;
  onHook: (row: LintRow) => void;
  onReopen: (row: LintRow) => void;
  onRewrite: (row: LintRow) => void;
  onStub: (f: Parameters<ReturnType<typeof useLintApply>["onStub"]>[0]) => void;
  onWrite: (f: Parameters<ReturnType<typeof useLintApply>["onWrite"]>[0]) => void;
  onFixpath: (f: Parameters<ReturnType<typeof useLintApply>["onFixpath"]>[0]) => void;
}) {
  const summary = summarizeRows(result.rows);
  const [verdictFilter, setVerdictFilter] = useState<string | null>(null);
  const byVerdict = (rows: LintRow[]) => (verdictFilter && verdictFilter !== "findings" ? rows.filter((r) => (verdictFilter === "failed" ? !r.judgment && !r.settled : verdictFilter === "settled" ? r.settled : !r.settled && r.judgment?.verdict === verdictFilter)) : rows);
  const projectRows = byVerdict(result.rows.filter((r) => r.scope === "project"));
  const globalRows = byVerdict(result.rows.filter((r) => r.scope === "global"));
  const showFindings = verdictFilter === null || verdictFilter === "findings";
  const chipCls = (activeV: boolean) => `cursor-pointer rounded-full border px-1.5 transition-colors ${activeV ? "border-(--tmd-accent) bg-(--tmd-accent)/10 text-(--tmd-accent)" : "border-(--tmd-border) hover:text-(--tmd-fg)"}`;
  const toggleVerdict = (v: string) => setVerdictFilter((cur) => (cur === v ? null : v));
  const rowProps = { busy, onApply, onKeep, onHook, onReopen, onRewrite };
  const [selected, setSelected] = useState<LintRow | null>(null);
  const select = useCallback((row: LintRow) => setSelected(row), []);
  const selectedRow = selected ? (result.rows.find((r) => r.rule.file === selected.rule.file && r.rule.line === selected.rule.line) ?? null) : null;
  return (
    <div className="flex min-h-0 flex-1 items-start">
      <div className="min-w-0 flex-1 pb-4">
      <ReportStats result={result} />
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5 text-meta text-(--tmd-fg-muted)">
        {t("规则 {n} 条 · 语料 {m} 消息/{c} 会话", {
          n: String(result.rows.length), m: String(result.corpus.msgs), c: String(result.corpus.sessionCount),
        })}
        {(Object.entries(summary.verdicts) as [string, number][]).map(([v, n]) =>
          n > 0 ? (
            <button key={v} type="button" onClick={() => toggleVerdict(v)} aria-pressed={verdictFilter === v} className={chipCls(verdictFilter === v)}>
              {t(VERDICT_LABEL[v as keyof typeof VERDICT_LABEL])} {n}
            </button>
          ) : null,
        )}
        {result.findings.length > 0 && (
          <button type="button" onClick={() => toggleVerdict("findings")} aria-pressed={verdictFilter === "findings"} className={chipCls(verdictFilter === "findings")}>{t("静态发现")} {result.findings.length}</button>
        )}
      </div>
      {(scopeFilter === "all" || scopeFilter === "project") && (
        <ScopeSection title={t("项目规则")} rows={projectRows} {...rowProps} onSelect={select} />
      )}
      {(scopeFilter === "all" || scopeFilter === "global") && (
        <ScopeSection title={t("全局规则")} rows={globalRows} {...rowProps} onSelect={select} />
      )}
      {result.findings.length > 0 && scopeFilter !== "global" && showFindings && (
        <div>
          <div className={SECTION_CLS}>{t("静态发现")}</div>
          {result.findings.map((f) => (
            <FindingRow key={f.id} finding={f} busy={busy} onStub={onStub} onWrite={onWrite} onFixpath={onFixpath} />
          ))}
        </div>
      )}
      </div>
      {selectedRow && <RuleDetailPanel row={selectedRow} busy={busy} onKeep={onKeep} onRewrite={onRewrite} />}
    </div>
  );
}

export function LintReportTab() {
  const { list, activeId } = useWorkspaces();
  const cwd = list.find((w) => w.id === activeId)?.root ?? null;
  const workspaceId = activeId ?? null;
  const ctl = useCtl();
  const { markRowSettled, reopenRow, removeFinding } = useLintResultWrite();
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const onError = useCallback((msg: string) => setActionError(msg), []);
  const apply = useLintApply(cwd, onError, removeFinding);
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  /* 结果时间戳作历史区刷新信号(扫描/应用后 +1 由 store 重载承担) */
  const revision = ctl.result?.at ?? 0;

  useEffect(() => {
    void loadStore().then((d) => {
      if (d.lastResult && d.lastResult.cwd === cwd) seedLintResult(d.lastResult as LintRunResult);
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时回放 */
  }, [cwd]);

  const start = useCallback(() => {
    if (!cwd) return;
    setActionError("");
    void (async () => {
      /* 引擎/模型沿用上次选择(选择器在右栏视图,报告页只发起) */
      const d = await loadStore();
      const engineId = d.lastUsed?.engineId ?? "omp";
      const model = d.lastUsed?.model ?? "";
      await setLastUsed(engineId, model);
      startLint({ cwd, workspaceId, engineId, model: model.trim() || null, scopes: ["project", "global"], onError: setActionError });
    })();
  }, [cwd, workspaceId]);

  const result = ctl.result;
  const pendingCount = result?.rows.filter((r) => r.aiMark && !r.aiMark.recognizable && r.aiMark.rewrite && !r.settled).length ?? 0;
  const phase = reportPhase(ctl.running, ctl.progress?.step, !!result);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ReportToolbar
        cwd={cwd} running={ctl.running} failed={!!ctl.error} hasResult={!!result} phase={phase}
        scopeFilter={scopeFilter} setScopeFilter={setScopeFilter}
        pendingCount={pendingCount}
        busy={apply.busy} onStart={start}
        onApplyAll={() => result && apply.onApplyAllAi(result.rows, (a, s) => setNotice(t("已应用 {a} 条改写,跳过 {s} 条(行号对不上)", { a: String(a), s: String(s) })))}
      />
      {notice && <div className="flex-none px-3 py-1.5 text-meta text-(--tmd-ok)">{notice}</div>}
      {(ctl.error || actionError) && (
        <div className="flex-none px-3 py-1.5 text-meta text-(--tmd-error)">{ctl.error || actionError}</div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {ctl.running ? (
          <LintProcessing result={ctl.result} progress={ctl.progress} engineId={ctl.runMeta.engineId} model={ctl.runMeta.model} scopeFilter={scopeFilter} />
        ) : (
          <>
            {result && <ReportBody result={result} scopeFilter={scopeFilter} busy={apply.busy} onApply={apply.onApply} onKeep={markRowSettled} onHook={apply.onHook} onReopen={reopenRow} onRewrite={apply.onRewrite} onStub={apply.onStub} onWrite={apply.onWrite} onFixpath={apply.onFixpath} />}
            {!result && (
              <div className="px-3 py-3 text-meta leading-relaxed text-(--tmd-fg-muted)">
                {t("还没有报告;点「体检」开始:脚本扫描逐条上屏,再把完整配置发给 AI 逐条识别,能执行的标记说明,不能执行的给改写建议。")}
              </div>
            )}
            <ScanHistory revision={revision} cwd={cwd} />
            <ApplyJournal revision={revision} onError={setActionError} />
          </>
        )}
      </div>
      {apply.confirm && (
        <ConfirmDialog
          title={apply.confirm.title}
          message={apply.confirm.message}
          danger
          confirmLabel={t("确认")}
          onConfirm={() => {
            apply.confirm!.run();
            apply.closeConfirm();
          }}
          onClose={apply.closeConfirm}
        />
      )}
    </div>
  );
}
