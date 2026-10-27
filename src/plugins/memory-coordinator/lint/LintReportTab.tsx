/**
 * 规则体检报告(中央 tab,kind="lint-report")—— 完整闭环视图。
 *
 * 分区:项目规则 / 全局规则(各自目标文件 + 规则行 + 各自动作)、静态发现、
 * 扫描记录(每次体检)、应用记录(每次保存前后内容,可撤销可回看)。
 * 运行态与右栏视图同源(lintController 单例):体检在任一处启动,两边同时生长。
 */

import { useCallback, useEffect, useState } from "react";
import { Pulse } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { ConfirmDialog } from "@kernel/DialogConfirm";
import { useWorkspaces } from "@kernel/workspace";
import { summarizeRows, type LintRunResult } from "./lintModel";
import { loadStore, setLastUsed } from "./lintStore";
import { seedLintResult, startLint } from "./lintController";
import { useLintApply, useLintController as useCtl, useLintResultWrite } from "./lintPanelState";
import { VERDICT_LABEL, type LintRow, type LintScope } from "./lintTypes";
import { FindingRow, RuleRow } from "./LintRows";
import { ApplyJournal, ScanHistory } from "./LintReportHistory";

type ScopeFilter = "all" | LintScope;

const SECTION_CLS = "border-y border-(--tmd-border) bg-(--tmd-bg-subtle) px-3 py-1 text-meta font-medium text-(--tmd-fg-muted)";

/** 单个 scope 分区:文件分组规则行(行即时上屏由控制器驱动)。 */
function ScopeSection({
  title, rows, busy, onApply, onKeep, onHook, onReopen, onRewrite,
}: {
  title: string;
  rows: LintRow[];
  busy: boolean;
  onApply: (row: LintRow, advice: Parameters<ReturnType<typeof useLintApply>["onApply"]>[1]) => void;
  onKeep: (row: LintRow) => void;
  onHook: (row: LintRow) => void;
  onReopen: (row: LintRow) => void;
  onRewrite: (row: LintRow) => void;
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
              onApply={onApply} onKeep={onKeep} onHook={onHook} onReopen={onReopen} onRewrite={onRewrite}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** 报告体:统计汇总行 + 双 scope 分区 + 静态发现(全局过滤时隐藏发现)。 */
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
  const projectRows = result.rows.filter((r) => r.scope === "project");
  const globalRows = result.rows.filter((r) => r.scope === "global");
  const rowProps = { busy, onApply, onKeep, onHook, onReopen, onRewrite };
  return (
    <>
      <div className="grid grid-cols-4 gap-1.5 px-3 py-1.5">
        <div className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-subtle) px-2 py-1.5"><b className="block text-base">{new Set(result.rows.map((r) => r.rule.file)).size}</b><span className="text-meta text-(--tmd-fg-faint)">{t("已扫描文件")}</span></div>
        <div className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-subtle) px-2 py-1.5"><b className="block text-base">{result.rows.length}</b><span className="text-meta text-(--tmd-fg-faint)">{t("提取规则")}</span></div>
        <div className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-subtle) px-2 py-1.5"><b className="block text-base">{result.rows.length - summary.failed}</b><span className="text-meta text-(--tmd-fg-faint)">{t("完成判定")}</span></div>
        <div className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-subtle) px-2 py-1.5"><b className="block text-base">{result.findings.length}</b><span className="text-meta text-(--tmd-fg-faint)">{t("静态发现")}</span></div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5 text-meta text-(--tmd-fg-muted)">
        {t("规则 {n} 条 · 语料 {m} 消息/{c} 会话", {
          n: String(result.rows.length), m: String(result.corpus.msgs), c: String(result.corpus.sessionCount),
        })}
        {(Object.entries(summary.verdicts) as [string, number][]).map(([v, n]) =>
          n > 0 ? (
            <span key={v} className="rounded-full border border-(--tmd-border) px-1.5">
              {t(VERDICT_LABEL[v as keyof typeof VERDICT_LABEL])} {n}
            </span>
          ) : null,
        )}
        {result.findings.length > 0 && (
          <span className="rounded-full border border-(--tmd-border) px-1.5">{t("静态发现")} {result.findings.length}</span>
        )}
      </div>
      {(scopeFilter === "all" || scopeFilter === "project") && (
        <ScopeSection title={t("项目规则")} rows={projectRows} {...rowProps} />
      )}
      {(scopeFilter === "all" || scopeFilter === "global") && (
        <ScopeSection title={t("全局规则")} rows={globalRows} {...rowProps} />
      )}
      {result.findings.length > 0 && scopeFilter !== "global" && (
        <div>
          <div className={SECTION_CLS}>{t("静态发现")}</div>
          {result.findings.map((f) => (
            <FindingRow key={f.id} finding={f} busy={busy} onStub={onStub} onWrite={onWrite} onFixpath={onFixpath} />
          ))}
        </div>
      )}
    </>
  );
}

/** 报告头:标题 + 范围过滤 + 一键应用 + 体检发起。 */
function ReportToolbar({
  cwd, running, scopeFilter, setScopeFilter, canApplyAll, busy, onStart, onApplyAll,
}: {
  cwd: string | null; running: boolean; scopeFilter: ScopeFilter; setScopeFilter: (s: ScopeFilter) => void;
  canApplyAll: boolean; busy: boolean; onStart: () => void; onApplyAll: () => void;
}) {
  return (
    <div className="flex flex-none items-center gap-2 border-b border-(--tmd-border) px-3 py-2">
      <span className="text-xs font-medium text-(--tmd-fg)">{t("规则体检报告")}</span>
      <span className="text-meta text-(--tmd-fg-muted)">{cwd ?? ""}</span>
      {running && <Spinner />}
      <div className="ml-auto flex items-center gap-1.5">
        {(["all", "project", "global"] as ScopeFilter[]).map((s) => (
          <button key={s} type="button" onClick={() => setScopeFilter(s)} className={`rounded-full border px-2 py-0.5 text-meta ${scopeFilter === s ? "border-(--tmd-accent) text-(--tmd-accent)" : "border-(--tmd-border) text-(--tmd-fg-muted) hover:text-(--tmd-fg)"}`}>
            {t(s === "all" ? "全部" : s === "project" ? "项目规则" : "全局规则")}
          </button>
        ))}
        <button
          type="button"
          disabled={busy || !canApplyAll}
          onClick={onApplyAll}
          className="rounded-full border border-(--tmd-accent) px-2 py-0.5 text-meta text-(--tmd-accent) transition-colors hover:bg-(--tmd-accent)/10 disabled:opacity-50"
        >
          {t("一键应用 AI 结果")}
        </button>
        <button
          type="button" onClick={onStart} disabled={running || !cwd}
          className="inline-flex items-center gap-1 rounded border border-(--tmd-border) px-2 py-0.5 text-meta text-(--tmd-fg-muted) transition-colors hover:border-(--tmd-accent) hover:text-(--tmd-accent) disabled:opacity-50"
        >
          {running ? <Spinner /> : <Pulse aria-hidden />}
          {t("体检")}
        </button>
      </div>
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ReportToolbar
        cwd={cwd} running={ctl.running} scopeFilter={scopeFilter} setScopeFilter={setScopeFilter}
        canApplyAll={!!result?.rows.some((r) => r.aiMark && !r.aiMark.recognizable && r.aiMark.rewrite && !r.settled)}
        busy={apply.busy} onStart={start}
        onApplyAll={() => result && apply.onApplyAllAi(result.rows, (a, s) => setNotice(t("已应用 {a} 条改写,跳过 {s} 条(行号对不上)", { a: String(a), s: String(s) })))}
      />
      {notice && <div className="flex-none px-3 py-1.5 text-meta text-(--tmd-ok)">{notice}</div>}
      {(ctl.error || actionError) && (
        <div className="flex-none px-3 py-1.5 text-meta text-(--tmd-error)">{ctl.error || actionError}</div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {result && <ReportBody result={result} scopeFilter={scopeFilter} busy={apply.busy} onApply={apply.onApply} onKeep={markRowSettled} onHook={apply.onHook} onReopen={reopenRow} onRewrite={apply.onRewrite} onStub={apply.onStub} onWrite={apply.onWrite} onFixpath={apply.onFixpath} />}
        {!result && (
          <div className="px-3 py-3 text-meta leading-relaxed text-(--tmd-fg-muted)">
            {t("还没有报告;点「体检」开始:脚本扫描逐条上屏,再把完整配置发给 AI 逐条识别,能执行的标记说明,不能执行的给改写建议。")}
          </div>
        )}
        <ScanHistory revision={revision} cwd={cwd} />
        <ApplyJournal revision={revision} onError={setActionError} />
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
