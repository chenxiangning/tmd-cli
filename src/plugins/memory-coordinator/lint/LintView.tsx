/**
 * 记忆文件面板 · 规则体检视图(tmd-lint 收编,内嵌于本面板,自带返回)。
 *
 * 交互闭环(用户定版):点「体检」→ 第一步脚本扫描,规则行逐文件即时上屏
 * (待测 → 证据注入 → AI 识别标记回填 → 生效判定逐批回填);第二步完整配置
 * 发模型逐条识别。重交互(一键应用/扫描记录/应用记录回看)在中央报告 tab,
 * 本视图保持进度+紧凑结果;「完整报告」钮跳转。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { LintHeaderBar } from "./LintHeaderBar";
import { t } from "@kernel/i18n";
import { ConfirmDialog } from "@kernel/DialogConfirm";
import { summarizeRows, type LintProgress, type LintRunResult } from "./lintModel";
import { loadStore, setLastUsed } from "./lintStore";
import { seedLintResult, startLint } from "./lintController";
import { useLintApply, useLintController, useLintResultWrite } from "./lintPanelState";
import { VERDICT_LABEL, type LintRow } from "./lintTypes";
import { FindingRow, RuleRow } from "./LintRows";

const CHIP_CLS = (active: boolean) =>
  `rounded-full border px-2 py-0.5 text-meta transition-colors ${
    active ? "border-(--tmd-accent) bg-(--tmd-accent)/10 text-(--tmd-accent)" : "border-(--tmd-border) text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
  }`;

/** 进度步进文案(纯函数,组件外)。 */
function stepLineOf(p: LintProgress): string {
  if (p.step === "recognize") return t("AI 识别中(全文比对)…{f}", { f: p.detail });
  if (p.step === "judge") return t("AI 判定中 {d}/{t}", { d: String(p.done ?? 0), t: String(p.total ?? 0) });
  if (p.step === "corpus") return p.detail ? t("读对话中…({p})", { p: p.detail }) : t("读对话中…");
  if (p.step === "evidence") return t("抽证据中…({n} 条消息)", { n: p.detail });
  if (p.step === "targets") return t("读规则中…");
  return t("体检完成");
}

/* 头部条在 LintHeaderBar(模型下拉与工作台引擎选择同口径)。 */

/** 汇总条:全部/各判定态/AI 不可识别/失败/拍板(点段过滤)。 */
function VerdictChips({
  result, summary, filter, setFilter,
}: {
  result: LintRunResult;
  summary: ReturnType<typeof summarizeRows>;
  filter: string;
  setFilter: (f: string) => void;
}) {
  return (
    <div className="flex flex-none flex-wrap gap-1 px-1.5 py-1">
      <button type="button" className={CHIP_CLS(filter === "all")} onClick={() => setFilter("all")}>
        {t("全部")} {result.rows.length}
      </button>
      {(Object.entries(summary.verdicts) as [string, number][]).map(([v, n]) =>
        n > 0 ? (
          <button key={v} type="button" className={CHIP_CLS(filter === v)} onClick={() => setFilter(v)}>
            {t(VERDICT_LABEL[v as keyof typeof VERDICT_LABEL])} {n}
          </button>
        ) : null,
      )}
      <button type="button" className={CHIP_CLS(filter === "ai-bad")} onClick={() => setFilter("ai-bad")}>
        {t("AI 不可识别")} {result.rows.filter((r) => r.aiMark && !r.aiMark.recognizable).length}
      </button>
      {summary.failed > 0 && (
        <button type="button" className={CHIP_CLS(filter === "failed")} onClick={() => setFilter("failed")}>
          {t("判定失败")} {summary.failed}
        </button>
      )}
      {summary.settled > 0 && (
        <button type="button" className={CHIP_CLS(filter === "settled")} onClick={() => setFilter("settled")}>
          {t("已拍板")} {summary.settled}
        </button>
      )}
    </div>
  );
}

/** 运行中过程块:步进文案 + AI 流式尾窗。 */
function RunProgress({ progress }: { progress: LintProgress }) {
  return (
    <div className="flex-none px-1.5 pb-1.5">
      <div className="text-meta text-(--tmd-fg-muted)">{stepLineOf(progress)}</div>
      {progress.live && (
        <pre className="mt-1 max-h-24 overflow-hidden whitespace-pre-wrap break-all font-mono text-[10px] leading-snug text-(--tmd-fg-faint)">
          {progress.live}
        </pre>
      )}
    </div>
  );
}

/** 行列表 + 一键应用 AI 结果入口。 */
function RowList({
  rows, busy, onApplyAll, rowProps,
}: {
  rows: LintRow[];
  busy: boolean;
  onApplyAll: () => void;
  rowProps: { onApply: (row: LintRow, advice: Parameters<ReturnType<typeof useLintApply>["onApply"]>[1]) => void; onKeep: (row: LintRow) => void; onHook: (row: LintRow) => void; onReopen: (row: LintRow) => void; onRewrite: (row: LintRow) => void };
}) {
  return (
    <>
      {rows.map((r) => (
        <RuleRow key={`${r.rule.file}:${r.rule.line}`} row={r} busy={busy} {...rowProps} />
      ))}
      {rows.length === 0 && <div className="p-3 text-center text-xs text-(--tmd-fg-faint)">{t("该过滤下没有条目")}</div>}
      {rows.some((r) => r.aiMark && !r.aiMark.recognizable && r.aiMark.rewrite) && (
        <div className="px-1.5 pt-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={onApplyAll}
            className="w-full rounded border border-(--tmd-accent) px-2 py-1 text-meta text-(--tmd-accent) transition-colors hover:bg-(--tmd-accent)/10 disabled:opacity-50"
          >
            {t("一键应用 AI 结果")}
          </button>
        </div>
      )}
    </>
  );
}

export function LintView({ cwd, workspaceId, onBack }: { cwd: string | null; workspaceId: string | null; onBack: () => void }) {
  const ctl = useLintController();
  const { markRowSettled, reopenRow, removeFinding } = useLintResultWrite();
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const onError = useCallback((msg: string) => setActionError(msg), []);
  const apply = useLintApply(cwd, onError, removeFinding);
  const [engineId, setEngineId] = useState("omp");
  const [model, setModel] = useState("");
  const [filter, setFilter] = useState<string>("all");

  /* 挂载:回填上次引擎选择;同 cwd 的上次结果播种进控制器(重开不丢) */
  useEffect(() => {
    void loadStore().then((d) => {
      if (d.lastUsed) {
        setEngineId(d.lastUsed.engineId);
        setModel(d.lastUsed.model);
      }
      if (d.lastResult && d.lastResult.cwd === cwd) {
        /* 旧存储形态缺新字段,播种前补齐 */
        seedLintResult({
          ...d.lastResult,
          corpus: (d.lastResult as LintRunResult).corpus ?? { sessionCount: 0, readFiles: 0, msgs: d.lastResult.rows.length, calls: 0 },
          failedBatches: (d.lastResult as LintRunResult).failedBatches ?? 0,
          engineError: (d.lastResult as LintRunResult).engineError ?? "",
          backups: (d.lastResult as LintRunResult).backups ?? [],
        });
      }
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时回放 */
  }, [cwd]);

  const showError = ctl.error || actionError;
  const start = useCallback(() => {
    if (!cwd) return;
    void setLastUsed(engineId, model).then(() => {
      setActionError("");
      setNotice("");
      startLint({ cwd, workspaceId, engineId, model: model.trim() || null, scopes: ["project", "global"], onError: setActionError });
    });
  }, [cwd, engineId, model, workspaceId]);

  const result = ctl.result;
  const summary = useMemo(() => (result ? summarizeRows(result.rows) : null), [result]);
  const shown = useMemo(() => {
    if (!result || filter === "all") return result?.rows ?? [];
    if (filter === "ai-bad") return result.rows.filter((r) => r.aiMark && !r.aiMark.recognizable);
    if (filter === "ai-ok") return result.rows.filter((r) => r.aiMark?.recognizable);
    return result.rows.filter((r) => (filter === "settled" ? r.settled : filter === "failed" ? !r.judgment && !r.settled : !r.settled && r.judgment?.verdict === filter));
  }, [result, filter]);

  const rowProps = {
    busy: ctl.running || apply.busy,
    onApply: apply.onApply, onKeep: markRowSettled, onHook: apply.onHook,
    onReopen: reopenRow, onRewrite: apply.onRewrite,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <LintHeaderBar
        engineId={engineId} model={model} running={ctl.running} cwd={cwd}
        setEngineId={setEngineId} setModel={setModel} onStart={start} onBack={onBack}
      />
      {!cwd && <div className="flex-none px-1.5 pb-1.5 text-meta text-(--tmd-fg-muted)">{t("打开一个工作区后可体检其规则文件")}</div>}
      {ctl.running && ctl.progress && <RunProgress progress={ctl.progress} />}
      {showError && <div className="flex-none px-1.5 pb-1.5 text-meta text-(--tmd-error)">{showError}</div>}
      {notice && <div className="flex-none px-1.5 pb-1.5 text-meta text-(--tmd-ok)">{notice}</div>}

      {result && summary && (
        <div className="flex min-h-0 flex-1 flex-col">
          <VerdictChips result={result} summary={summary} filter={filter} setFilter={setFilter} />
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {result.findings.map((f) => (
              <FindingRow key={f.id} finding={f} busy={apply.busy} onStub={apply.onStub} onWrite={apply.onWrite} onFixpath={apply.onFixpath} />
            ))}
            <div className="border-y border-(--tmd-border) bg-(--tmd-bg-subtle) px-1.5 py-1 text-meta font-medium text-(--tmd-fg-muted)">
              {t("规则 {n} 条 · 语料 {m} 消息/{c} 会话 · 项目+全局", {
                n: String(result.rows.length), m: String(result.corpus.msgs), c: String(result.corpus.sessionCount),
              })}
            </div>
            <RowList
              rows={shown}
              busy={ctl.running || apply.busy}
              onApplyAll={() =>
                apply.onApplyAllAi(result.rows, (a, s) => {
                  setNotice(t("已应用 {a} 条改写,跳过 {s} 条(行号对不上)", { a: String(a), s: String(s) }));
                })
              }
              rowProps={rowProps}
            />
          </div>
        </div>
      )}
      {!result && !ctl.running && (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 text-meta leading-relaxed text-(--tmd-fg-muted)">
          {t(
            "体检两步走:先脚本扫描(读各家 CLI 近 30 天对话日志,规则逐条上屏),再把配置完整发给 AI 逐条识别——能执行的打标记给说明,不能执行的给修改建议,可单条改也可一键应用。",
          )}
        </div>
      )}
      <div className="flex-none border-t border-(--tmd-border) px-1.5 py-1.5 text-meta leading-relaxed text-(--tmd-fg-muted)">
        {t("每次应用记前后内容(报告页可回看/恢复);写回前自动备份 .bak-tmdlint;判定随引擎与模型而异")}
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
