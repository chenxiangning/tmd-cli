/**
 * 体检运行态 · 中央处理视图(规则细项 + loading 进度)。
 * 运行中接管 LintReportTab 中央区:进度条 + 按文件分组的规则行
 * (已提取·待测 / 识别中 / 判定中 / 已判定徽章)+ 右侧当前批次脚本测量摘要;
 * 结束后切回 ReportBody(报告页),本视图不再渲染。
 */

import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { FileTextIcon, SparkleIcon } from "@phosphor-icons/react";
import type { LintProgress, LintRunResult } from "./lintModel";
import type { ScopeFilter } from "./LintReportChrome";
import { VERDICT_LABEL, type LintRow, type LintVerdict } from "./lintTypes";

const VERDICT_CLS: Record<LintVerdict, string> = {
  working: "bg-(--tmd-ok)/10 text-(--tmd-ok)",
  violated: "bg-(--tmd-error)/10 text-(--tmd-error)",
  touched: "bg-(--tmd-accent)/10 text-(--tmd-accent)",
  dormant: "bg-(--tmd-warn)/10 text-(--tmd-warn)",
  unverifiable: "bg-(--tmd-bg-subtle) text-(--tmd-fg-muted)",
};

/** 步进 → 总进度百分比(脚本 45 / 判定 45–95 / 完成 100)。 */
function percentOf(p: LintProgress | null): number {
  const step = p?.step;
  if (!step || step === "targets") return 6;
  if (step === "corpus") return 18;
  if (step === "evidence") return 30;
  if (step === "recognize") return 45;
  if (step === "judge") return 45 + Math.round(((p.done ?? 0) / Math.max(p.total ?? 1, 1)) * 50);
  return 100;
}

/** 行状态徽章:已判定(色) / 判定中(spinner) / 待判定(已识别) / 识别中(spinner) / 已提取·待测。 */
function RowState({ row, recognizing, judging }: { row: LintRow; recognizing: boolean; judging: boolean }) {
  if (row.judgment) {
    const v = row.judgment.verdict;
    return <span className={`flex-none rounded px-1.5 py-0.5 text-[10px] ${VERDICT_CLS[v]}`}>{t(VERDICT_LABEL[v])}</span>;
  }
  if (row.aiMark) {
    return <span className="flex-none rounded bg-(--tmd-accent)/5 px-1.5 py-0.5 text-[10px] text-(--tmd-accent)">{t("待判定")}</span>;
  }
  if (judging) {
    return (
      <span className="flex flex-none items-center gap-1 rounded bg-(--tmd-accent)/10 px-1.5 py-0.5 text-[10px] text-(--tmd-accent)">
        <Spinner />
        {t("判定中")}
      </span>
    );
  }
  if (recognizing) {
    return (
      <span className="flex flex-none items-center gap-1 rounded bg-(--tmd-accent)/10 px-1.5 py-0.5 text-[10px] text-(--tmd-accent)">
        <Spinner />
        {t("识别中")}
      </span>
    );
  }
  return (
    <span className="flex-none rounded bg-(--tmd-bg-subtle) px-1.5 py-0.5 text-[10px] text-(--tmd-fg-muted)">{t("已提取 · 待测")}</span>
  );
}

/** 单个文件的规则行组;当前规则用浅色底与脉冲标记处理位置。 */
function FileGroup({ absPath, rows, scope, recognizing, judgingFile, currentKeys }: { absPath: string; rows: LintRow[]; scope: LintRow["scope"]; recognizing: boolean; judgingFile: string | null; currentKeys: Set<string> }) {
  return (
    <section className="mb-4 last:mb-0">
      <div className="flex items-center gap-2 px-1 pb-1.5 text-meta font-medium text-(--tmd-fg-muted)">
        <FileTextIcon className="flex-none text-(--tmd-accent)" size={12} aria-hidden />
        <span className="min-w-0 truncate font-mono" title={absPath}>{absPath}</span>
        <span className={`flex-none rounded-full px-2 py-0.5 text-[10px] ${scope === "global" ? "bg-(--tmd-accent)/10 text-(--tmd-accent)" : "bg-(--tmd-ok)/10 text-(--tmd-ok)"}`}>
          {t(scope === "global" ? "全局规则" : "项目规则")}
        </span>
        <span className="ml-auto flex-none rounded-full bg-(--tmd-bg-subtle) px-2 py-0.5 text-[10px]">{t("{n} 条", { n: String(rows.length) })}</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-(--tmd-border) bg-(--tmd-bg-elevated)">
        {rows.map((row) => {
          const key = `${row.rule.file}:${row.rule.line}`;
          const active = currentKeys.has(key);
          return (
            <div key={key} className={`flex min-h-9 items-center gap-2 border-b border-(--tmd-border) px-2.5 py-2 text-xs transition-colors last:border-b-0 hover:bg-(--tmd-accent)/5 ${active ? "bg-(--tmd-accent)/5" : ""}`}>
              <RowState row={row} recognizing={recognizing} judging={judgingFile === row.rule.file.split("/").pop()} />
              <span className="min-w-0 flex-1 truncate leading-relaxed text-(--tmd-fg)" title={row.rule.text}>{row.rule.text}</span>
              {active && <span className="size-1.5 flex-none rounded-full bg-(--tmd-accent) motion-safe:animate-pulse" aria-hidden />}
              <span className="flex-none font-mono text-[10px] text-(--tmd-fg-faint)">L{row.rule.line}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** 可见范围内项目/全局各取一条当前未判定规则(无则空)。 */
function currentRowsByScope(rows: LintRow[]): LintRow[] {
  return (["project", "global"] as const)
    .map((scope) => rows.find((r) => r.scope === scope && !r.judgment))
    .filter((r): r is LintRow => !!r);
}

export function LintProcessing({
  result, progress, engineId, model, scopeFilter,
}: {
  result: LintRunResult | null;
  progress: LintProgress | null;
  engineId: string;
  model: string;
  scopeFilter: ScopeFilter;
}) {
  const rows = result?.rows ?? [];
  const visibleRows = scopeFilter === "all" ? rows : rows.filter((r) => r.scope === scopeFilter);
  const judged = rows.filter((r) => r.judgment).length;
  const currents = currentRowsByScope(visibleRows);
  const current = currents[0];
  const currentKeys = new Set(currents.map((r) => `${r.rule.file}:${r.rule.line}`));
  const hasVisibleRows = visibleRows.length > 0;
  const recognizing = progress?.step === "recognize";
  const judgingFile = progress?.step === "judge" && progress.detail ? progress.detail : null;
  const waiting = (progress?.waitSec ?? 0) > 3;
  const pct = percentOf(progress);
  return (
    <div className="@container flex h-full flex-col" aria-busy="true">
      <div className="border-b border-(--tmd-border) bg-(--tmd-bg-elevated) px-4 py-3">
        <div className="flex items-center gap-2">
          <Spinner />
          <span className="text-xs font-semibold text-(--tmd-fg)">{t("规则体检 · 处理中")}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-(--tmd-accent)/10 px-2 py-0.5 text-[10px] text-(--tmd-accent)">
            {progress?.step === "judge" && <SparkleIcon size={11} aria-hidden />}
            {progress?.step === "judge" ? t("AI 逐条判定") : t("脚本扫描")}
          </span>
          <span className="ml-auto font-mono text-xs font-semibold text-(--tmd-accent)">{pct}%</span>
        </div>
        <div className="mt-1 text-meta text-(--tmd-fg-muted)">
          {waiting
            ? t("AI 判定中 · 已等 {s}s · 单次调用(引擎输出会缓冲,完成即整批上屏)", { s: String(progress?.waitSec ?? 0) })
            : t("已判定 {d}/{t} · {w}", { d: String(judged), t: String(rows.length), w: current ? t("当前批次：{f}", { f: current.rule.file.split("/").pop() ?? "" }) : t("批次收尾中") })}
        </div>
        <div
          className="mt-2.5 h-2 overflow-hidden rounded-full bg-(--tmd-accent-soft)"
          role="progressbar"
          aria-label={t("规则体检进度")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className={`h-full rounded-full bg-(--tmd-accent) transition-[width] duration-500 ${waiting ? "motion-safe:animate-pulse" : ""}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1.5 text-meta text-(--tmd-fg-muted)">
          {engineId} · {model || t("默认模型")} · {t("发给模型 = 规则 + 脚本测量摘要,对话原文不出本机 · 超时上限 1200s")}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 @min-[720px]:grid-cols-[minmax(0,1fr)_295px]">
        <div className="min-h-0 border-b border-(--tmd-border) px-4 py-3 @min-[720px]:border-r @min-[720px]:border-b-0">
          {[...new Map(visibleRows.map((r) => [r.rule.file, r])).entries()].map(([file, sample]) => {
            const group = visibleRows.filter((r) => r.rule.file === file);
              return <FileGroup key={file} absPath={file} rows={group} scope={sample.scope} recognizing={recognizing} judgingFile={judgingFile} currentKeys={currentKeys} />;
            })}
          {visibleRows.length === 0 && <div className="py-3 text-center text-xs text-(--tmd-fg-faint)">{t("规则提取后逐条上屏…")}</div>}
        </div>
        <CurrentRulesPanel currents={currents} hasRows={hasVisibleRows} />
      </div>
    </div>
  );
}

/** 右栏当前规则面板:全部口径 = 项目/全局两张,单选 = 一张;无当前行时给状态说明。 */
function CurrentRulesPanel({ currents, hasRows }: { currents: LintRow[]; hasRows: boolean }) {
  if (currents.length === 0) {
    return (
      <aside className="min-h-0 overflow-y-auto bg-(--tmd-bg-subtle)">
        <div className="px-3.5 py-3">
          <p className="text-meta text-(--tmd-fg-faint)">{hasRows ? t("批次收尾中") : t("脚本扫描中,规则提取后这里显示当前批次的规则与脚本计数。")}</p>
        </div>
      </aside>
    );
  }
  return (
    <aside className="min-h-0 overflow-y-auto bg-(--tmd-bg-subtle)">
      {currents.map((row) => <CurrentRuleCard key={`${row.rule.file}:${row.rule.line}`} current={row} />)}
    </aside>
  );
}

/** 右栏单个当前规则卡(全部口径下项目/全局各一张,由外层滚动面板承载)。 */
function CurrentRuleCard({ current }: { current: LintRow }) {
  return (
    <section className="border-b border-(--tmd-border) px-3.5 py-3 last:border-b-0">
      <h3 className="flex items-center gap-1.5 font-mono text-xs font-semibold text-(--tmd-fg)" title={current.rule.file}>
        <span className={`flex-none rounded-full px-1.5 py-0.5 font-sans text-[10px] font-medium ${current.scope === "global" ? "bg-(--tmd-accent)/10 text-(--tmd-accent)" : "bg-(--tmd-ok)/10 text-(--tmd-ok)"}`}>
          {t(current.scope === "global" ? "全局规则" : "项目规则")}
        </span>
        <span className="min-w-0 truncate">{current.rule.file.split("/").pop()} · L{current.rule.line}</span>
      </h3>
      <div className="mt-2.5 rounded-md border-l-2 border-l-(--tmd-accent) bg-(--tmd-bg-elevated) px-3 py-2.5 text-xs leading-relaxed text-(--tmd-fg)">{current.rule.text}</div>
      <div className="mt-3 text-[10px] font-medium tracking-wide text-(--tmd-fg-faint)">{t("脚本测量摘要(随规则发模型)")}</div>
      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        <div className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) px-1 py-1.5 text-center"><b className="block text-sm">{current.evidence?.hits ?? "—"}</b><span className="text-[9px] text-(--tmd-fg-faint)">{t("触达消息")}</span></div>
        <div className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) px-1 py-1.5 text-center"><b className="block text-sm">{current.evidence?.activeSessions ?? "—"}</b><span className="text-[9px] text-(--tmd-fg-faint)">{t("相关会话")}</span></div>
        <div className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) px-1 py-1.5 text-center"><b className="block text-sm">{current.evidence?.corrections ?? "—"}</b><span className="text-[9px] text-(--tmd-fg-faint)">{t("当场纠正")}</span></div>
      </div>
      <p className="mt-2.5 text-[10px] leading-relaxed text-(--tmd-fg-faint)">{t("AI 只看规则原文与这些计数,给出最终判定;对话原文不出本机。")}</p>
    </section>
  );
}
