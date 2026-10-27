/**
 * 规则体检面板(tmd-lint 移植主入口)—— 右栏 filePanel 生态组。
 *
 * 头部:引擎选择 + 体检钮;过程:六步管线进度 + AI 流式尾窗;结果:判定分布
 * 汇总条(点段过滤)+ 逐条规则行(下钻证据/建议动作)+ 静态发现。判定由 AI
 * 大模型实时语义判断(详见 aiJudge.ts);本组件只装配,状态钩子与子组件拆分
 * 见 lintPanelState.tsx(守复杂度与 300 行铁则)。
 */

import { useCallback, useEffect, useState } from "react";
import { Pulse } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { StyledSelect } from "@kernel/StyledSelect";
import { ConfirmDialog } from "@kernel/DialogConfirm";
import { useWorkspaces } from "@kernel/workspace";
import { JUDGE_ENGINES } from "./aiJudge";
import { summarizeRows, type LintProgress, type LintRunResult } from "./lintModel";
import { loadStore, setLastUsed } from "./lintStore";
import { VERDICT_LABEL, type LintRow, type StaticFinding } from "./lintTypes";
import { FindingRow, RuleRow } from "./LintRows";
import { useLintApply, useLintResultWrite, useLintRun } from "./lintPanelState";

type Filter = "all" | "violated" | "working" | "touched" | "dormant" | "unverifiable" | "failed" | "settled";

const CHIP_CLS = (active: boolean) =>
  `rounded-full border px-2 py-0.5 text-meta transition-colors ${
    active
      ? "border-(--tmd-accent) bg-(--tmd-accent)/10 text-(--tmd-accent)"
      : "border-(--tmd-border) text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
  }`;

/** 进度步进文案(纯函数,组件外)。 */
function stepLineOf(progress: LintProgress): string {
  if (progress.step === "judge") return t("AI 判定中 {d}/{t}", { d: String(progress.done ?? 0), t: String(progress.total ?? 0) });
  if (progress.step === "corpus") return t("读对话中…");
  if (progress.step === "evidence") return t("抽证据中…({n} 条消息)", { n: progress.detail });
  if (progress.step === "targets") return t("定目标中…");
  return t("体检完成");
}

/** 行过滤(纯函数,组件外):all / 各判定态 / failed / settled。 */
function filterRows(rows: LintRow[], filter: Filter): LintRow[] {
  if (filter === "all") return rows;
  if (filter === "settled") return rows.filter((r) => r.settled);
  if (filter === "failed") return rows.filter((r) => !r.judgment && !r.settled);
  return rows.filter((r) => !r.settled && r.judgment?.verdict === filter);
}

/** 头部:引擎/模型选择 + 体检钮。 */
function HeaderBar({
  engineId, model, running, cwd, setEngineId, setModel, onStart,
}: {
  engineId: string; model: string; running: boolean; cwd: string | null;
  setEngineId: (v: string) => void; setModel: (v: string) => void; onStart: () => void;
}) {
  return (
    <div className="flex flex-none items-center gap-1.5 px-1.5 py-1.5">
      <StyledSelect
        value={engineId}
        onChange={setEngineId}
        ariaLabel={t("判定引擎")}
        className="min-w-0 flex-none"
        options={JUDGE_ENGINES.map((e) => ({ value: e.id, label: e.id }))}
      />
      <input
        value={model}
        onChange={(e) => setModel(e.target.value)}
        placeholder={t("模型占位")}
        className="min-w-0 flex-1 rounded border border-(--tmd-border) bg-transparent px-1.5 py-0.5 font-mono text-meta text-(--tmd-fg) placeholder:text-(--tmd-fg-faint)"
      />
      <button
        type="button"
        onClick={onStart}
        disabled={running || !cwd}
        className="flex-none rounded border border-(--tmd-border) px-2 py-0.5 text-meta text-(--tmd-fg-muted) transition-colors hover:border-(--tmd-accent) hover:text-(--tmd-accent) disabled:opacity-50"
        title={t("读本机近 30 天对话日志,AI 逐条判定规则是否生效")}
      >
        <span className="inline-flex items-center gap-1">
          {running ? <Spinner /> : <Pulse aria-hidden />}
          {t("体检")}
        </span>
      </button>
    </div>
  );
}

/** 运行中过程块:步进文案 + AI 流式尾窗。 */
function ProgressBlock({ progress }: { progress: LintProgress }) {
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

/** 结果区:判定分布汇总条(点段过滤)+ 静态发现 + 规则行列表。 */
function ResultBody({
  result, filter, busy, onFilter, onApply, onKeep, onStub,
}: {
  result: LintRunResult;
  filter: Filter;
  busy: boolean;
  onFilter: (f: Filter) => void;
  onApply: (row: LintRow, advice: Parameters<ReturnType<typeof useLintApply>["onApply"]>[1]) => void;
  onKeep: (row: LintRow) => void;
  onStub: (finding: StaticFinding) => void;
}) {
  const summary = summarizeRows(result.rows);
  const shown = filterRows(result.rows, filter);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none flex-wrap gap-1 px-1.5 py-1">
        <button type="button" className={CHIP_CLS(filter === "all")} onClick={() => onFilter("all")}>
          {t("全部")} {result.rows.length}
        </button>
        {(Object.entries(summary.verdicts) as [keyof typeof VERDICT_LABEL, number][]).map(([v, n]) =>
          n > 0 ? (
            <button key={v} type="button" className={CHIP_CLS(filter === v)} onClick={() => onFilter(v)}>
              {t(VERDICT_LABEL[v])} {n}
            </button>
          ) : null,
        )}
        {summary.failed > 0 && (
          <button type="button" className={CHIP_CLS(filter === "failed")} onClick={() => onFilter("failed")}>
            {t("判定失败")} {summary.failed}
          </button>
        )}
        {summary.settled > 0 && (
          <button type="button" className={CHIP_CLS(filter === "settled")} onClick={() => onFilter("settled")}>
            {t("已拍板")} {summary.settled}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {result.findings.length > 0 && (
          <>
            <div className="border-y border-(--tmd-border) bg-(--tmd-bg-subtle) px-1.5 py-1 text-meta font-medium text-(--tmd-fg-muted)">
              {t("静态发现")}
            </div>
            {result.findings.map((f) => (
              <FindingRow key={f.id} finding={f} busy={busy} onStub={onStub} />
            ))}
          </>
        )}
        <div className="border-y border-(--tmd-border) bg-(--tmd-bg-subtle) px-1.5 py-1 text-meta font-medium text-(--tmd-fg-muted)">
          {t("规则 {n} 条 · 语料 {m} 消息/{c} 会话", {
            n: String(result.rows.length), m: String(result.corpus.msgs), c: String(result.corpus.sessionCount),
          })}
        </div>
        {shown.map((r) => (
          <RuleRow key={`${r.rule.file}:${r.rule.line}`} row={r} busy={busy} onApply={onApply} onKeep={onKeep} />
        ))}
        {shown.length === 0 && (
          <div className="p-3 text-center text-xs text-(--tmd-fg-faint)">{t("该过滤下没有条目")}</div>
        )}
      </div>
    </div>
  );
}

export function LintPanel() {
  const { list, activeId } = useWorkspaces();
  const cwd = list.find((w) => w.id === activeId)?.root ?? null;
  const workspaceId = activeId ?? null;
  const [engineId, setEngineId] = useState("omp");
  const [model, setModel] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const onError = useCallback((msg: string) => setError(msg), []);

  const run = useLintRun(cwd, workspaceId, engineId, model, onError);
  const { markRowSettled, removeFinding } = useLintResultWrite(run.result, run.applyResult);
  const apply = useLintApply(cwd, onError, markRowSettled, removeFinding);
  const result = run.result;

  /* 首载/切仓:回填上次引擎选择;cwd 相同则重放缓存结果(面板重开不丢) */
  useEffect(() => {
    void loadStore().then((d) => {
      if (d.lastUsed) {
        setEngineId(d.lastUsed.engineId);
        setModel(d.lastUsed.model);
      }
      if (d.lastResult && d.lastResult.cwd === cwd) run.applyResult(d.lastResult as LintRunResult);
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载与切仓时回放 */
  }, [cwd]);

  const start = useCallback(() => {
    void setLastUsed(engineId, model).then(() => run.start());
  }, [engineId, model, run]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-icon-decor="lint">
      <HeaderBar
        engineId={engineId} model={model} running={run.running} cwd={cwd}
        setEngineId={setEngineId} setModel={setModel} onStart={start}
      />
      {!cwd && <div className="flex-none px-1.5 pb-1.5 text-meta text-(--tmd-fg-muted)">{t("打开一个工作区后可体检其规则文件")}</div>}
      {run.running && run.progress && <ProgressBlock progress={run.progress} />}
      {error && <div className="flex-none px-1.5 pb-1.5 text-meta text-(--tmd-error)">{error}</div>}

      {result && <ResultBody result={result} filter={filter} busy={apply.busy} onFilter={setFilter} onApply={apply.onApply} onKeep={apply.onKeep} onStub={apply.onStub} />}
      {!result && !run.running && (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 text-meta leading-relaxed text-(--tmd-fg-muted)">
          {t(
            "体检 = 读本机各家 CLI 近 30 天对话日志,与规则文件逐条对照;是否生效由 AI 大模型按证据实时语义判断,纠正原话与照做证据随包附上供核对。",
          )}
        </div>
      )}
      <div className="flex-none border-t border-(--tmd-border) px-1.5 py-1.5 text-meta leading-relaxed text-(--tmd-fg-muted)">
        {t("写回前自动备份 .bak-tmdlint;对话日志只读,零上传;判定随引擎与模型而异,建议动作仅供决策参考")}
      </div>
      {apply.confirm && (
        <ConfirmDialog
          title={apply.confirm.title}
          message={apply.confirm.message}
          danger
          confirmLabel={t("删除")}
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
